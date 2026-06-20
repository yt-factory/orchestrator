// `make cost-dump` — per-call cost breakdown for a run.
//
// Empirical anchor for the V4 cost-regression investigation. Reads the
// append-only per-call log (data/llm-calls.jsonl) and prints every completion
// sorted by cost descending, with the reasoning-token column that exposes
// DeepSeek thinking-mode output blowups.
//
//   bun run cost-dump                 # latest run only (most-recent projectId)
//   bun run cost-dump --all           # every logged call
//   bun run cost-dump --project=<id>  # one project
//   bun run cost-dump --since=<iso>   # calls at/after an ISO timestamp
//
// The "Out/Expected" column compares actual output tokens against the per-task
// cap in task-config.ts. A ratio far above 1.0 — especially paired with non-zero
// Reasoning — is the smoking gun for thinking mode being on.

import { readCallRecords, type LLMCallRecord } from '../llm/base/call-log';
import { maxTokensForTask } from '../llm/task-config';
import { selectRecords } from './cost-dump-select';

function ratioCell(rec: LLMCallRecord): string {
  const expected = maxTokensForTask(rec.label);
  if (expected === undefined) return `${rec.outputTokens}/?`;
  const x = (rec.outputTokens / expected).toFixed(1);
  return `${rec.outputTokens}/${expected} (${x}x)`;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function padLeft(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

function main(): void {
  const argv = process.argv.slice(2);
  const allRecords = readCallRecords();
  if (allRecords.length === 0) {
    console.log('make cost-dump: no calls logged.');
    console.log('Run a real pipeline first (e.g. `make process` with a live provider).');
    console.log('The log is append-only — MOCK/cached-only runs may still be empty.');
    return;
  }

  const { records, scope } = selectRecords(allRecords, argv);
  if (records.length === 0) {
    console.log(`make cost-dump: no calls matched (${scope}). Try --all.`);
    return;
  }

  const sorted = [...records].sort((a, b) => b.costUsd - a.costUsd);

  const cols = { stage: 24, tier: 6, model: 18, in: 8, out: 8, reason: 10, cost: 10, ratio: 18 };
  const header =
    pad('Stage', cols.stage) +
    pad('Tier', cols.tier) +
    pad('Model', cols.model) +
    padLeft('In', cols.in) +
    padLeft('Out', cols.out) +
    padLeft('Reason', cols.reason) +
    padLeft('Cost', cols.cost) +
    '  ' +
    pad('Out/Expected', cols.ratio);

  const lines: string[] = [];
  lines.push('═'.repeat(header.length));
  lines.push(`  LLM COST DUMP — ${scope}, per call, sorted by cost ↓`);
  lines.push('═'.repeat(header.length));
  lines.push(header);
  lines.push('─'.repeat(header.length));

  let totalCost = 0;
  let totalIn = 0;
  let totalOut = 0;
  let totalReason = 0;
  let cacheHits = 0;

  for (const rec of sorted) {
    totalCost += rec.costUsd;
    totalIn += rec.inputTokens;
    totalOut += rec.outputTokens;
    totalReason += rec.reasoningTokens;
    if (rec.fromLocalCache) cacheHits += 1;

    const stageLabel = (rec.label ?? '(unlabeled)') + (rec.fromLocalCache ? ' ⚡' : '');
    lines.push(
      pad(stageLabel, cols.stage) +
        pad(rec.tier, cols.tier) +
        pad(rec.model, cols.model) +
        padLeft(String(rec.inputTokens), cols.in) +
        padLeft(String(rec.outputTokens), cols.out) +
        padLeft(String(rec.reasoningTokens), cols.reason) +
        padLeft('$' + rec.costUsd.toFixed(4), cols.cost) +
        '  ' +
        pad(ratioCell(rec), cols.ratio),
    );
  }

  lines.push('─'.repeat(header.length));
  lines.push(
    pad(`TOTAL (${sorted.length} calls, ${cacheHits} ⚡cache)`, cols.stage + cols.tier + cols.model) +
      padLeft(String(totalIn), cols.in) +
      padLeft(String(totalOut), cols.out) +
      padLeft(String(totalReason), cols.reason) +
      padLeft('$' + totalCost.toFixed(4), cols.cost),
  );
  lines.push('═'.repeat(header.length));

  // Verdict hint — does the data support the thinking-mode hypothesis?
  if (totalReason > 0) {
    const reasonPct = ((totalReason / Math.max(totalOut, 1)) * 100).toFixed(0);
    lines.push('');
    lines.push(`⚠️  Reasoning tokens present: ${totalReason} (${reasonPct}% of output tokens).`);
    lines.push('    DeepSeek thinking mode is ACTIVE for these calls — expected 0 after the fast-tier fix.');
  } else {
    lines.push('');
    lines.push('✅  No reasoning tokens — thinking mode is off for these calls.');
  }

  console.log(lines.join('\n'));
}

main();
