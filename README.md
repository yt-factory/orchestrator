# YT-Factory Orchestrator

The brain of the YT-Factory pipeline — an automated YouTube content production system that turns raw text/markdown (e.g. a "极客禅" koan) into publish-ready SEO metadata and, optionally, full video projects.

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                     YT-Factory Orchestrator                         │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   incoming/ files ──> FolderWatcher ──> WorkflowManager            │
│                              │                                      │
│                              ▼                                      │
│   ┌──────────────────────────────────────────────────────────┐     │
│   │              LLM Provider Abstraction                     │     │
│   │  call site declares tier ──> provider resolves model      │     │
│   │     'fast'  ──> deepseek-v4-flash  (thinking OFF)         │     │
│   │     'smart' ──> deepseek-v4-pro                           │     │
│   │  content-hash cache ─┐  prefix cache (98% off) ─┐          │     │
│   │  priority queue ──> token bucket ──> circuit breaker      │     │
│   └──────────────────────────────────────────────────────────┘     │
│                              │  (fallback provider: Gemini)         │
│                              ▼                                      │
│                     manifest.json per project                       │
│              (Zod-validated; LLM fields coerce-with-warn)           │
│                              │                                      │
│                              ▼                                      │
│   make seo  (copy-paste metadata)   │   video-renderer → YouTube    │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

The active provider is selected by `LLM_PROVIDER` (`deepseek` | `gemini`). Every
call site declares a cost **tier** (`fast` | `smart`); the provider maps that to a
concrete model. DeepSeek's `fast` tier runs with thinking mode disabled and a
per-task `max_tokens` cap — see [MIGRATION.md](./MIGRATION.md) for the cost story.

## Quick Start

```bash
cd orchestrator
bun install
mkdir -p incoming active_projects data

# Mock mode (no API keys)
MOCK_MODE=true bun run start

# Real run (DeepSeek primary)
LLM_PROVIDER=deepseek DEEPSEEK_API_KEY=sk-... bun run process   # --once, then exits

# Or via the repo Makefile (one level up)
make process            # watch+process incoming, auto-exit
make seo                # print copy-paste SEO for the latest project (zh_TW)
make seo-xhs            # same, 小红书 (zh_CN_XHS)
make cost-dump          # per-call cost breakdown of the latest run
make compare KOAN=ep48  # re-run one koan safely (snapshot → run → restore)
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Bun |
| Language | TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) |
| Validation | Zod v4 |
| LLM (primary) | DeepSeek via OpenAI-compatible SDK (`deepseek-v4-flash` / `-pro`) |
| LLM (fallback) | Google Gemini (`@google/generative-ai`) — also the NotebookLM path |
| Prompts | Nunjucks templates with version frontmatter (externalized under `prompts/`) |
| Chinese variants | `opencc-js` (Traditional ⇄ Simplified per locale) |
| File Watch | chokidar |
| Resilience | Token Bucket + Priority Queue + Circuit Breaker + content-hash cache |

## Project Structure

```
orchestrator/
├── src/
│   ├── core/
│   │   ├── watcher.ts          # Directory monitoring (chokidar)
│   │   ├── workflow.ts         # State machine + heartbeat + stale recovery
│   │   └── manifest.ts         # Zod schema (source of truth) + coerce-with-warn
│   ├── llm/                    # Provider abstraction (V2 cost refactor)
│   │   ├── providers/          # deepseek.ts, gemini.ts, model/pricing tables
│   │   ├── base/               # provider.ts, cost-tracker, cache, call-log
│   │   ├── prompts/loader.ts   # Nunjucks prompt loader (version-driven cache)
│   │   ├── schema-helpers.ts   # coerceEnum / defaultIfMissing / truncate*
│   │   └── task-config.ts      # per-task max_tokens caps
│   ├── agents/
│   │   ├── seo-expert.ts       # Per-locale SEO (title/description/FAQ/tags)
│   │   ├── trends-hook.ts      # Trend authority scoring + decay
│   │   ├── shorts-extractor.ts # Emotional-arc hooks (full mode)
│   │   └── notebooklm-generator.ts # Bilingual podcast scripts (full mode)
│   ├── seo/                    # tags.ts (opencc), chapters.ts (regex)
│   ├── parsers/koan.ts         # Koan front-matter parser
│   ├── config/pipeline-mode.ts # PIPELINE_MODE (full | seo_only)
│   ├── templates/filters.ts    # opencc s2tw/tw2s + per-locale tag rendering
│   ├── cli/                    # print-seo, cost-dump, compare-koan, report-cost
│   └── index.ts                # Entry point (9-stage pipeline)
├── prompts/                    # Externalized system/user prompts (versioned)
├── incoming/  active_projects/  processed/  data/  .cache/llm/
└── .env
```

## Processing Pipeline (9 Stages)

| Stage | Name | `seo_only`? |
|-------|------|-------------|
| 1 | INIT | ✅ runs |
| 2 | SCRIPT_GENERATION | ⏭ skipped |
| 3 | TREND_ANALYSIS | ✅ runs |
| 4 | SEO_GENERATION (per-locale title/description/FAQ/tags) | ✅ runs |
| 5 | SHORTS_EXTRACTION | ⏭ skipped |
| 6 | VOICE_MATCHING | ⏭ skipped |
| 7 | NOTEBOOKLM_GENERATION | ⏭ skipped |
| 8 | MANIFEST_UPDATE | ✅ runs |
| 9 | FINALIZATION | ✅ runs |

`PIPELINE_MODE=seo_only` runs only stages 1/3/4/8/9 (SEO output only). Skipped
stages write honest empty/null values, never placeholders. `PIPELINE_MODE=full`
runs all nine.

## Key Features

### Tiered, cost-optimized LLM access
- Every call declares `tier: 'fast' | 'smart'`; the provider resolves the model.
- DeepSeek `fast` disables thinking mode (`{ thinking: { type: 'disabled' } }`)
  and caps output via `src/llm/task-config.ts` (FAQ 800, title 50, …).
- Transparent **content-hash cache** (`.cache/llm/`): a repeat of an identical
  call costs $0. DeepSeek's **prefix cache** bills shared system prompts at ~2% .
- Per-koan cost dropped from a `$9.21` monthly batch baseline to **~$0.0008**.

### Two-locale SEO
- `zh_TW` (YouTube main) and `zh_CN_XHS` (小红书), each with its own title hook,
  description, and Chinese-language FAQ.
- Tags are stored canonical and rendered per locale at print time via `opencc`
  (Traditional for zh_TW, Simplified for zh_CN_XHS).

### Resilient schema validation ("bends, not breaks")
LLM output is probabilistic — it invents enum values, omits required fields,
returns the wrong type, or overruns caps. Rather than hard-reject the whole
manifest, every LLM-generated field **coerces with a warning** via
`src/llm/schema-helpers.ts`:

| Failure mode | Helper | Example |
|---|---|---|
| invalid / missing enum | `coerceEnum` | `entity.type "algorithm" → "concept"` |
| missing **or wrong-type** field | `defaultIfMissing` | `faq.related_entities "x" → []` |
| array / string over cap | `truncateIfOverflow` / `truncateStringIfOverflow` | `tags[40] → first 30` |

Each coercion emits a `logger.warn` (field, received, coerced-to). The warn rate
is a prompt-quality signal: frequent warnings on a koan mean the prompt needs
strengthening. See MIGRATION.md → *Defensive schema design* for the full table.

### Trend authority scoring
`fleeting` (1 window) → `emerging` (2) → `established` (3+); 24h decay for stale
keywords; established trends are favored in titles.

### Stale project recovery
Heartbeat monitors active projects every 60s; stuck projects auto-recover; a dead
letter state catches repeated failures.

## Cost & observability

```bash
make cost-dump          # per-call table: stage | tier | model | in | out | reason | cost
make report-cost        # cumulative totals vs the Phase-1 baseline
```

`make cost-dump` reads the append-only per-call log (`data/llm-calls.jsonl`) and
shows each call's tokens — including **reasoning tokens** (0 when thinking is off)
— for the latest run by default (`--all` / `--project=<id>` / `--since=<iso>`).

> ⚠️ `manifest.meta.cost` is **cumulative** across every run of a project — do not
> read it as a per-run figure. `make cost-dump` is the per-run ground truth.
> (`make seo` deliberately does not print cost for this reason.)

## Configuration

```bash
# --- Provider selection ---
LLM_PROVIDER=deepseek                 # deepseek | gemini
DEEPSEEK_API_KEY=sk-...               # required when LLM_PROVIDER=deepseek
DEEPSEEK_BASE_URL=https://api.deepseek.com
GEMINI_API_KEY=...                    # Gemini provider + NotebookLM path
MOCK_MODE=false                       # true → mock responses, no keys needed

# --- Pipeline ---
PIPELINE_MODE=seo_only                # full | seo_only

# --- LLM cache ---
LLM_CACHE_ENABLED=true                # content-hash cache master switch
LLM_CACHE_DIR=.cache/llm
FORCE_NO_LLM_CACHE=                   # 1/true bypasses the cache for the run
LLM_CALL_LOG=data/llm-calls.jsonl     # per-call log read by cost-dump

# --- Rate / timeout / resilience ---
LLM_RATE_LIMIT_RPM=60
DEEPSEEK_API_TIMEOUT_MS=120000
HEARTBEAT_INTERVAL_MS=60000
STALE_THRESHOLD_ANALYZING_MS=600000
MAX_STALE_RECOVERY_COUNT=3
MAX_RETRIES=3
LOG_LEVEL=info                        # debug | info | warn | error
```

## Manifest Schema (contract with video-renderer)

```typescript
{
  project_id: string,
  status: 'pending' | 'analyzing' | 'pending_audio' | 'rendering' | 'completed' | 'failed' | ...,
  input_source: { local_path, raw_content, word_count },
  content_engine: {
    script: ScriptSegment[],                 // [] in seo_only
    seo: {
      tags: string[],                        // canonical; rendered per locale at print
      chapters: string,
      regional_seo: [                        // exactly 2 locales
        { language: 'zh_TW'|'zh_CN_XHS', titles: string[], description: string,
          faq: { question, answer, related_entities }[] }
      ],
      entities: { name, type, description? }[],
      trend_coverage_score: number
    },
    shorts: ShortsExtraction,                // empty hooks in seo_only
    media_preference: { visual, voice }
  },
  audio?: { source, languages: { en?, zh? } },
  meta: { model_used, cost: { total_tokens_used, estimated_cost_usd /* cumulative */ } }
}
```

All LLM-populated fields are validated through the coerce-with-warn helpers, so a
single odd value never rejects the whole manifest.

## Usage Examples

### Process one koan and grab its SEO

```bash
echo "# 空间换时间 ..." > incoming/ep99_demo.md
make process                 # auto-detects, processes, exits
make seo                     # zh_TW title / description / tags / FAQ
make seo-xhs                 # zh_CN_XHS variant
```

### Safely re-run a koan (snapshot → run → restore)

```bash
make compare KOAN=ep48       # never deletes from processed/; restores data files
FORCE_NO_LLM_CACHE=1 bun run compare ep48   # force fresh API calls (bypass cache)
```

### Inspect cost of the last run

```bash
make cost-dump               # latest run, per call, sorted by cost ↓
bun run cost-dump --all      # every logged call
```

## Troubleshooting

### "DEEPSEEK_API_KEY required"
Set `DEEPSEEK_API_KEY`, or switch `LLM_PROVIDER=gemini`, or `MOCK_MODE=true`.

### A run cost more than expected
`make cost-dump` — check the **Reason** column. Non-zero reasoning tokens mean
thinking mode slipped on (should be 0 for `fast`). High `Out/Expected` ratios
point at a task overrunning its `max_tokens` budget.

### A koan crashed Stage 9 validation
Shouldn't happen for LLM fields anymore (they coerce). If it does, the error path
in the manifest names the field; check whether it's an LLM field that needs a
helper (see MIGRATION.md → *Defensive schema design*). Grep landmines with:
`grep -nE "z.enum|\.max\(|\.min\(1\)|\.positive\(\)|\.regex\(" src/core/manifest.ts`.

### Project stuck in `analyzing`
The 60s heartbeat auto-recovers stale projects. To force: set `status: "pending"`
in `active_projects/<id>/manifest.json`.

## TypeScript

```bash
make typecheck      # tsc --noEmit (orchestrator + video-renderer)
bun test            # unit + schema-coercion + cost-dump suites
```

## Recent Updates

- **2026-06 (V2–V4 + Resilience).** LLM provider abstraction + DeepSeek primary +
  tiered models; content-hash cache; `PIPELINE_MODE=seo_only`; 2-locale per-locale
  SEO (title/description/FAQ); thinking-mode-off + per-task `max_tokens`
  (~24× cost cut); `make cost-dump`; and systematic coerce-with-warn validation
  for every LLM-generated schema field. Full detail in [MIGRATION.md](./MIGRATION.md).
- **2026-02.** Circuit breaker, bounded priority queue, token-bucket jitter, API
  timeouts, FileHashManager race fix.

---

*Part of the [YT-Factory](../docs/SETUP.md) YouTube automation ecosystem.
Migration history & design rationale: [MIGRATION.md](./MIGRATION.md).*
