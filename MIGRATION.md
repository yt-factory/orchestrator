# LLM Cost-Optimization Refactor — Migration Notes

This document is for whoever maintains the orchestrator's LLM path next
(likely future-us). It describes what changed, how to roll back, how to recover
content, and what's intentionally left unfinished.

Original spec: `cc_tasks/CLAUDE_TASK_org-yt-factory_v2_phase2-6.md`.
Commit-by-commit history: `git log c225d50..68123cf` (don't duplicate it here).

---

## Why

The `make process && make seo` chain generated YouTube SEO metadata (summary,
titles, description, tags) by calling Google Gemini. In practice **100% of
1,274 calls ran on `gemini-3-pro-preview`** — the most expensive model — because
the fallback chain only ever used its top entry on the happy path. Cost was
~$9.21 and climbing (+523% MoM). The fix: a provider abstraction with a
mandatory cost tier, a DeepSeek primary, a content-hash cache, prefix-cache-
friendly prompt structure, and template-driven SEO that uses the LLM only for
"点睛" touches. (NotebookLM video generation is untouched — it's free and works.)

---

## What changed

- **Provider abstraction** (`src/llm/`): `BaseLLMProvider` owns the shared
  machinery (priority queue, token bucket, circuit breaker, cost tracking),
  hoisted from the old `gemini-client`. Providers implement only the API call,
  tier→model resolution, and pricing.
- **Mandatory cost tier**: every call site declares `tier: "fast" | "smart"`.
  `fast` → cheap model (extraction/ranking/hooks); `smart` → creative copy.
- **DeepSeek primary** (`LLM_PROVIDER=deepseek`) via the OpenAI-compatible
  endpoint; Gemini retained as fallback and for NotebookLM.
- **No more `gemini-3-pro-preview`**: tiers map to `gemini-2.5-flash` /
  `gemini-2.5-pro`; the NotebookLM fallback chain's top slot is `gemini-2.5-pro`.
- **Content-hash cache** in `BaseLLMProvider.complete()`: identical request →
  cached result, `$0`, near-instant. `.cache/llm/` + `_index.jsonl`.
- **Prefix-cache prompt structure**: the 5 regional SEO calls share one static
  system prompt (`prompts/_shared/regional-system.md`) so DeepSeek prefix-caches
  it (98% input discount) across calls and videos.
- **Externalized prompts**: inline strings → versioned `prompts/*.{system.md,
  user.j2}`, rendered by a Nunjucks loader; `version` frontmatter drives cache
  invalidation.
- **Koan parser** (`src/parsers/koan.ts`, strict, TDD): extracts episode / names
  / CS concept from H1+H2. `bun run parse-koans` → `data/koan_parse_report.json`.
- **Template-driven SEO**: title = LLM hook + `<hook> | <name> | <concept>`;
  description = Nunjucks template + one LLM hook paragraph; tags = static core +
  parsed + LLM supplements; chapters = regex (never invented).
- **Tooling**: `make report-cost`, `make compare KOAN=xx`, `process FORCE=1`,
  `clean-llm-cache` — behavior in versioned bun scripts, root Makefile delegates.

### V3 follow-up (SEO-only pipeline)

- **`PIPELINE_MODE=seo_only`**: skips the LLM-heavy stages the NotebookLM-video
  workflow doesn't need (script, shorts, voice-match, NotebookLM script) —
  ~3:23 → ~38s, ~$0.0083 → ~$0.0017 per koan. Stage 6's visual mood/content_type
  still runs (cheap, deterministic, consumed downstream).
- **Skip-safe schema (forward guidance)**: PIPELINE_MODE-skipped stages produce
  empty/zero/null values, and the schema tolerates these as honest
  representations of skipped work — never substitute placeholders. Anyone adding
  a new pipeline stage must keep this contract: make the field nullable/empty-able
  rather than faking content (e.g. `estimated_duration_seconds` is `.nonnegative()`
  so a skipped Stage 2 can write 0).
- **Locales 5 → 2**: `zh_TW` (YouTube) + `zh_CN_XHS` (小红书); dropped en/es/ja/de.
  `cultural_hooks` removed from `RegionalSEOSchema`.
- **Per-locale descriptions**: the description hook is generated per locale (was
  one shared paragraph — a commit-10 bug). zh_TW renders Traditional via the
  `opencc-js` `toTraditional` Nunjucks filter; zh_CN_XHS stays Simplified.
- **`make seo` rewrite**: `src/cli/print-seo.ts` (bun) prints title + description +
  tags + FAQ + cost in the requested locale (`make seo` / `seo-xhs` / `seo-json`).
- **`tokens_by_model`** is now an open `z.record` — accumulates whatever models
  actually run (e.g. `deepseek-v4-flash`) instead of a hardcoded gemini-3 key set.

---

## New environment variables

| Var | Default if unset | Effect |
|-----|------------------|--------|
| `LLM_PROVIDER` | `gemini` | Active provider for pipeline (non-NotebookLM) calls: `deepseek` \| `gemini`. |
| `DEEPSEEK_API_KEY` | — | **Required** when `LLM_PROVIDER=deepseek`; provider throws a clear error if missing (no silent fallback). |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek endpoint override. |
| `DEEPSEEK_RATE_LIMIT_RPM` | `LLM_RATE_LIMIT_RPM` or `60` | DeepSeek token-bucket rate. |
| `DEEPSEEK_API_TIMEOUT_MS` | `GEMINI_API_TIMEOUT_MS` or `120000` | DeepSeek request timeout. |
| `GEMINI_API_KEY` | — | Required for Gemini provider + the NotebookLM path (unless `MOCK_MODE=true`). |
| `GEMINI_FAST_MODEL` | `gemini-2.5-flash` | Gemini `fast` tier model. |
| `GEMINI_SMART_MODEL` | `gemini-2.5-pro` | Gemini `smart` tier model. |
| `GEMINI_PRO_MODEL` | `gemini-2.5-pro` | NotebookLM fallback-chain top slot. **Note:** a stale `.env` may still set `gemini-3.1-pro-preview` — update it. |
| `LLM_CACHE_ENABLED` | `true` (unless `false`) | Master switch for the content-hash cache. |
| `LLM_CACHE_DIR` | `.cache/llm` | Cache location. |
| `FORCE_NO_LLM_CACHE` | unset | `1`/`true` bypasses the cache for the run (set by `process:force` / `make process FORCE=1`). |
| `LLM_RATE_LIMIT_RPM` | `60` | Default per-provider rate when a provider-specific var is unset. |
| `PIPELINE_MODE` | `full` | `seo_only` skips script/shorts/voice/NotebookLM stages (SEO-only output). Unknown values warn and default to `full`. |

---

## Rollback

- **L1 — one koan looks wrong.** Inspect with `make compare KOAN=epNN` (produces
  a fresh manifest, diffs against a baseline if present). Re-run that koan with
  a different `LLM_PROVIDER` in `.env` if needed.
- **L2 — DeepSeek misbehaving overall.** Set `LLM_PROVIDER=gemini` in `.env`.
  All non-NotebookLM calls run on `gemini-2.5-flash` / `gemini-2.5-pro` — a
  fully working path, and still **not** the old `gemini-3-pro-preview`.
- **L3 — refactor-wide problem.** `git revert` the range
  `c225d50..68123cf` (oldest→newest). Two caveats:
  - The repo-root `Makefile` is **not** in git; the revertable behavior lives in
    `orchestrator/package.json` scripts, and the Makefile is a thin delegator —
    so a revert restores script behavior, and the Makefile keeps working.
  - Superseded code is **archived, not deleted** — `src/prompts/title-ranker.ts`
    and the now-unused `prompts/seo/regional*`, `description`, `chapters`, `tags`
    prompt files remain present (unused on current `main`). A revert restores the
    older paths that use them; don't go hunting for "missing" code.

---

## Recovery

- **Koan content backup.** A koan's full text is preserved verbatim in
  `active_projects/{uuid}/manifest.json` under `input_source.raw_content`. To
  recover an accidentally-deleted source: extract that field from the most
  recent manifest for the koan and write it back to `processed/{file}.md`.
- **Watcher contract.** `processed/` is **canonical content storage**, not a
  scratch/working directory. The watcher *moves* files `incoming/ → processed/`.
  **Never `rm` from `processed/` during testing.**
- **Agent-safe testing pattern.** Snapshot anything you might mutate
  (`data/processed_hashes.json`, `data/cost_report.json`,
  `data/trends_authority.json`, the `active_projects/` listing) → run the
  pipeline → restore. To force a koan to reprocess, empty the hash cache for the
  run and restore it after. `src/cli/compare-koan.ts` implements exactly this.
- **Cautionary instance.** During commit-10 (`85b57d8`) verification, a
  `cp processed/koan → incoming` + `rm processed/koan` cleanup deleted the real
  `ep48` source; it was recovered from `raw_content` as above. The `compare`
  tool exists so this is never done by hand again.

---

## Cost outcome

Phase 1 baseline: **$9.21 / 1,274 calls** (100% `gemini-3-pro-preview`).

Post-refactor numbers are recorded in the verification log below (live DeepSeek
run is separately tracked). The authoritative per-run figure is the
`LLM: … | $…` summary line printed at the end of each pipeline run; `make
report-cost` aggregates cumulative usage and compares to the baseline.

### Verification log

| Date | Run | Provider | Calls | Cost | Cache hit | Notes |
|------|-----|----------|-------|------|-----------|-------|
| 2026-06-19 | MOCK cold | mock(gemini) | 20 | $0.0057 | 0/20 | end-to-end pass |
| 2026-06-19 | MOCK re-run (same koan) | mock(gemini) | 20 | $0.0000 | 20/20 | local cache validated |
| pending | Live RUN1 (koan A) | deepseek | — | — | — | first cold run |
| pending | Live RUN2 (same koan A) | deepseek | — | — | — | local cache → expect $0 |
| pending | Live RUN3 (koan B) | deepseek | — | — | — | prefix-cache check (expect ≥80%) |
| 2026-06-20 | Live seo_only (ep48) | deepseek | 11 | $0.0017 | 0/11 | PIPELINE_MODE=seo_only; 3:23 → 38s, ~80% cost cut |
| pending | Live per-locale desc (ep48) | deepseek | — | — | — | verify zh_TW ≠ zh_CN_XHS, locale-appropriate |
| 2026-06-20 | Live cost-dump (ep48) | deepseek | 10 | $0.0023 | 20% prefix | Case A confirmed: reasoning ~71% of output (2 calls @ 98%); thinking on by default |
| 2026-06-20 | Live post thinking-off (ep48, forced cold) | deepseek | 10 | $0.0010 | 16% prefix | reasoning_tokens=0 on all 10 calls; output 6103→1483 tokens; pipeline green |

Append rows; don't edit the prose above.

## V4 — per-locale fixes + cost investigation

V4 fixed three issues a live seo_only run surfaced:

- **P0 — FAQ was English in both Chinese locales.** `generateFAQ` now takes a
  `locale` and runs per locale inside the regional loop; the FAQ moved from a
  single top-level `faq_structured_data` to per-locale `regional_seo[].faq`.
- **P1 — tags carried stale years / irrelevant concepts / padding.** The trend
  prompt is constrained (no year numbers, substantive relevance only) and
  `buildTags` strips any tag containing a 4-digit year (`YEAR_RE`).
- **P2 — tags were mixed-script for `zh_CN_XHS`** (Traditional `CORE_STATIC_TAGS`
  shown to a Simplified audience) and **title hooks read alike across locales.**
  Tags are now rendered per locale at print time via opencc
  (`renderTagsForLocale`, with a `程式設計師→程序员` override that opencc's `tw2s`
  misses); the title-hook prompt enforces a distinct voice per locale.

**Dead module removed:** the FAQ schema move uncovered
`src/services/aio-feedback-loop.ts` (`AIOFeedbackLoop`) — fully unreferenced and
the only remaining reader of `faq_structured_data`. Deleted in the same change.

### Cost regression — diagnosed (Case A) and fixed

A live run jumped 24× over the seo_only baseline. Tooling was added first (no
pre-fix on hypothesis); the live inline log then **confirmed Case A**: `fast`
tier (`deepseek-v4-flash`) ran thinking mode by default, with **reasoning tokens
averaging ~71% of output** (two calls hit 98%).

Investigation tooling:

- DeepSeek `usage.completion_tokens_details.reasoning_tokens` is captured
  (`CompletionResult.reasoningTokens`).
- Every completion (cache hit or real call) is logged to `data/llm-calls.jsonl`
  (gitignored, **append-only** — see the truncation-trap fix below).
- `make cost-dump` prints the per-call table sorted by cost, with a **Reason**
  (thinking) column and an **Out/Expected** ratio.

The fix (`deepseek.ts._doComplete`):

- **Thinking off for `fast` tier** via `{ thinking: { type: 'disabled' } }`
  (DeepSeek param, verified at api-docs.deepseek.com 2026-06-20). `smart` keeps
  its default — creative copy can benefit from reasoning.
- **Per-task `max_tokens` caps** (`src/llm/task-config.ts`) as a runaway ceiling:
  faq 800, facts 800, description 400, trends 300, topic 200, tags 200, title 50.
- **`jsonMode: true` on all SEO/trends calls.** Live verification surfaced a
  latent bug: with thinking ON the model wrapped its answer in JSON, but with
  thinking OFF `title-hook` returned a bare string (`「最稀缺的，從來不是時間」`),
  failing the parser. Forcing `response_format: json_object` guarantees a JSON
  envelope regardless of thinking mode (all prompts already contain the literal
  "json" DeepSeek requires).

Live forced-cold run (ep48, 16% prefix cache): **$0.0010, reasoning_tokens=0 on
all 10 calls, output 6103→1483 tokens, pipeline green.** A warm run (local
content-hash cache) is $0; a natural run with ≥20% prefix cache lands ~$0.0008.

**Truncation-trap fix:** the per-call log was truncated on every process start,
so a "run again to confirm" with no new file wiped the prior run's data before it
could be read. It is now **append-only**; `make cost-dump` defaults to the latest
run (most-recent `projectId`) and accepts `--all` / `--project=<id>` / `--since=<iso>`.

#### Cost progression (per koan, seo_only)

| Stage | Cost / koan | Note |
|-------|-------------|------|
| Phase 1 baseline | ~$9.21 / 1,274 calls | 100% `gemini-3-pro-preview` (monthly batch) |
| V3 complete | $0.0017 | seo_only + DeepSeek + cache |
| V4 commit 1+2 (side effect) | $0.0023 | per-locale FAQ/tags; prefix cache started hitting (~20%) |
| One bad live run | $0.0414 | thinking mode unbounded (24× spike that triggered this) |
| V4 thinking-off (measured) | $0.0010 | forced-cold ep48; reasoning=0, output 6103→1483 tokens; ~$0.0008 on a warm prefix-cache run, $0 fully cached |

---

## What's intentionally unfinished

These are deliberate deferrals, not oversights — most need the live run to
decide correctly.

- **Locale-aware hook paragraph / footer / 5→2 collapse** — ✅ RESOLVED in V3
  (per-locale description hook; zh_TW Traditional via opencc; collapsed to
  zh_TW + zh_CN_XHS). Kept here for trace.
- **Title hook language for zh_TW.** The title-hook LLM output (e.g. 当代码遇见禅)
  can come back Simplified even for `LOCALE=zh_TW`, and `print-seo` does not run
  `toTraditional` over `titles[0]` (only the description is converted). Verify on
  the next live run: if the LLM produces Simplified for zh_TW despite the prompt,
  strengthen the prompt; if it's the print path, convert `titles[0]` for zh_TW.
- **Post-audio chapter extraction.** Real chapter timestamps only exist after
  audio renders. A future stage-9 step could extract them from TTS timing and
  write `chapters` back before upload. Until then chapters stay empty (by design,
  never invented).

## Stale schema in sibling repo

`video-renderer/src/core/manifest-parser.ts` is a Zod copy of the orchestrator
manifest schema that has drifted since commit 10 (assumes `titles.length(5)`,
`cultural_hooks` required, 5 locales).

Not in active use — `render.mjs` reads the manifest via direct JSON, not through
this parser. Safe to ignore now but will break if anyone wires it back in.

Resolution: separate video-renderer task to either delete the parser or sync it
to the current orchestrator schema (1 title, 2 locales, no `cultural_hooks`).

## Locale fallback in render.mjs (active path)

`render.mjs` uses `regional_seo.find(r => r.language === lang) || regional_seo[0]`.
With the 5→2 collapse, passing any locale other than `zh_TW` or `zh_CN_XHS`
silently falls back to `regional_seo[0]` (`zh_TW`). Callers should pass one of the
two supported locales explicitly.
