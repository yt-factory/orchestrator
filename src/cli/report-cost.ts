// Cost report (Phase 6) — prints LLM cost/usage to stdout (pipe-friendly).
//
//   bun run report-cost
//
// Sources:
//   data/cost_report.json     cumulative tokens/cost (global tracker)
//   .cache/llm/_index.jsonl   per-entry cache writes (provider/tier/costSaved)
//
// Caveat surfaced in the output: cost_report.json is cumulative across ALL runs
// (including pre-refactor gemini-3-pro-preview), so the cleanest post-refactor
// per-video figure is the "LLM:" run-summary line, not this cumulative total.

import { readFileSync, existsSync } from 'fs';

const COST_PATH = process.env.COST_REPORT_PATH ?? './data/cost_report.json';
const CACHE_INDEX = `${process.env.LLM_CACHE_DIR ?? './.cache/llm'}/_index.jsonl`;

// Phase 1 baseline (documented in MIGRATION.md): cumulative cost_report at the
// start of the refactor — everything on gemini-3-pro-preview.
const BASELINE = { usd: 9.21, calls: 1274, model: 'gemini-3-pro-preview' };

interface CostReport {
  total_tokens_used: number;
  tokens_by_model: Record<string, number>;
  estimated_cost_usd: number;
  api_calls_count: number;
}

function loadCost(): CostReport {
  if (!existsSync(COST_PATH)) {
    return { total_tokens_used: 0, tokens_by_model: {}, estimated_cost_usd: 0, api_calls_count: 0 };
  }
  return JSON.parse(readFileSync(COST_PATH, 'utf-8')) as CostReport;
}

function loadCacheIndex(): Array<Record<string, unknown>> {
  if (!existsSync(CACHE_INDEX)) return [];
  return readFileSync(CACHE_INDEX, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((x): x is Record<string, unknown> => x !== null);
}

function main(): void {
  const cost = loadCost();
  const cache = loadCacheIndex();

  const usd = cost.estimated_cost_usd ?? 0;
  const calls = cost.api_calls_count ?? 0;
  const perCall = calls > 0 ? usd / calls : 0;
  const baselinePerCall = BASELINE.usd / BASELINE.calls;
  const savingsPct = baselinePerCall > 0 ? Math.round((1 - perCall / baselinePerCall) * 100) : 0;

  const out: string[] = [];
  out.push('═══════════ LLM Cost Report ═══════════');
  out.push(`Cumulative: ${calls.toLocaleString()} calls | ${cost.total_tokens_used.toLocaleString()} tokens | $${usd.toFixed(4)}`);
  out.push('');
  out.push('Tokens by model (global tracker — Gemini-keyed):');
  for (const [model, tokens] of Object.entries(cost.tokens_by_model ?? {})) {
    out.push(`  ${model.padEnd(26)} ${Number(tokens).toLocaleString()}`);
  }
  out.push('');

  // Cache index stats
  const costSaved = cache.reduce((s, e) => s + (typeof e.costSaved === 'number' ? e.costSaved : 0), 0);
  out.push(`Local cache: ${cache.length} entries | ~$${costSaved.toFixed(4)} saved per full corpus re-run`);
  const byTier: Record<string, number> = {};
  for (const e of cache) {
    const key = `${e.provider}/${e.tier}`;
    byTier[key] = (byTier[key] ?? 0) + 1;
  }
  if (Object.keys(byTier).length > 0) {
    out.push('Cache entries by provider/tier:');
    for (const [key, count] of Object.entries(byTier)) out.push(`  ${key.padEnd(20)} ${count}`);
  }
  out.push('');

  out.push('─────────── vs Phase 1 baseline ───────────');
  out.push(`Phase 1 baseline: $${BASELINE.usd.toFixed(2)} / ${BASELINE.calls.toLocaleString()} calls = $${baselinePerCall.toFixed(5)}/call (${BASELINE.model})`);
  out.push(`Current:          $${usd.toFixed(2)} / ${calls.toLocaleString()} calls = $${perCall.toFixed(5)}/call`);
  out.push(`Per-call savings: ${savingsPct}%`);
  out.push('');
  out.push('Note: cost_report.json is cumulative across ALL runs (incl. pre-refactor');
  out.push('gemini-3-pro-preview). For a clean post-refactor figure, reset');
  out.push('data/cost_report.json, or read the per-run "LLM:" summary line.');

  console.log(out.join('\n'));
}

main();
