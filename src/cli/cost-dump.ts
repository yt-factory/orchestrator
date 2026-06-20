// `make cost-dump` — per-call cost breakdown for the latest run.
//
// Empirical anchor for the V4 P2 cost-regression investigation ($0.0017 ->
// $0.0414). Reads the per-call log (data/llm-calls.jsonl, truncated at each run
// start) and prints every completion sorted by cost descending, with the
// reasoning-token column that exposes DeepSeek thinking-mode output blowups.
//
//   bun run cost-dump
//
// The "Out/Expected" column compares actual output tokens against the rough
// size each task SHOULD produce — a ratio far above 1.0 (especially paired with
// non-zero Reasoning) is the smoking gun for thinking mode being on by default.

import { readCallRecords, type LLMCallRecord } from '../llm/base/call-log';

// Rough expected OUTPUT token size per task (the JSON payload we actually want).
// Keyed by the label prefix before ':'. Diagnostic reference only — this is NOT
// an enforced max_tokens (that's a separate fix, applied after this report).
const EXPECTED_OUTPUT_TOKENS: Record<string, number> = {
  topic: 200,
  facts: 800,
  faq: 800,
  tags: 300,
  title: 50,
  description: 400,
  trends: 300,
};

function expectedFor(label: string | undefined): number | null {
  if (!label) return null;
  const key = label.split(':')[0] ?? label;
  return EXPECTED_OUTPUT_TOKENS[key] ?? null;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function padLeft(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

function ratioCell(rec: LLMCallRecord): string {
  const expected = expectedFor(rec.label);
  if (expected === null) return `${rec.outputTokens}/?`;
  const x = (rec.outputTokens / expected).toFixed(1);
  return `${rec.outputTokens}/${expected} (${x}x)`;
}

function main(): void {
  const records = readCallRecords();
  if (records.length === 0) {
    console.log('make cost-dump: no calls logged.');
    console.log('Run a real pipeline first (e.g. `make process` with a live provider);');
    console.log('the log is truncated at each run start, so MOCK/cached-only runs may be empty.');
    return;
  }

  const sorted = [...records].sort((a, b) => b.costUsd - a.costUsd);

  const cols = {
    stage: 24,
    tier: 6,
    model: 18,
    in: 8,
    out: 8,
    reason: 10,
    cost: 10,
    ratio: 18,
  };

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
  lines.push('  LLM COST DUMP — latest run, per call, sorted by cost ↓');
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
    lines.push('    DeepSeek thinking mode appears ACTIVE — this is the likely cost driver.');
  } else {
    lines.push('');
    lines.push('ℹ️  No reasoning tokens reported. If cost is still high, look at the');
    lines.push('    Out/Expected column for tasks emitting far more output than needed.');
  }

  console.log(lines.join('\n'));
}

main();
