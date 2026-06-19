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

Append rows; don't edit the prose above.

---

## What's intentionally unfinished

These are deliberate deferrals, not oversights — most need the live run to
decide correctly.

- **Locale-aware hook paragraph.** The description hook paragraph is one
  Traditional-Chinese paragraph reused across all 5 locales. Fine if the locales
  are Chinese variants; broken if any is genuinely non-Chinese (en/ja). Decide
  after the live run.
- **Locale-aware footer.** The description footer currently mixes scripts —
  `用程序员的语言` is Simplified; for the Traditional-Chinese (Taiwan-primary)
  audience it should read `用程式設計師的語言`. Pulls from `profile.tagline`.
- **5 → 2 locale decision.** Whether to collapse the 5 locales to `zh_TW` +
  `zh_CN-XHS` or preserve a multilingual set — pending a live-run eyeball of
  whether the 5 title hooks come back genuinely distinct.
- **Post-audio chapter extraction.** Real chapter timestamps only exist after
  audio renders. A future stage-9 step could extract them from TTS timing and
  write `chapters` back before upload. Until then chapters stay empty (by design,
  never invented).
