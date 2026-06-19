// Batch koan parser (Phase 5, commit 9).
//
// Parses every koan markdown in the corpus and writes a structured report to
// data/koan_parse_report.json for manual review. Never modifies a koan file;
// parse problems are recorded, not thrown. This report is the gate before the
// SEO-templating work in commit 10.
//
//   bun run src/cli/parse-all-koans.ts

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseKoan } from '../parsers/koan';

const KOANS_DIR = process.env.KOANS_DIR ?? './processed';
const REPORT_PATH = process.env.KOAN_REPORT_PATH ?? './data/koan_parse_report.json';

interface WarningRow {
  file: string;
  episode: number;
  warning: string;
  detail: string;
}
interface FailureRow {
  file: string;
  episode: number | null;
  reason: string;
  rawH1?: string;
  rawH2?: string;
}

function main(): void {
  // CLAUDE.md is a claude-mem stub, never a koan — exclude it from the corpus.
  const NON_KOAN = new Set(['CLAUDE.md']);
  const files = readdirSync(KOANS_DIR)
    .filter((f) => f.endsWith('.md') && !NON_KOAN.has(f))
    .sort();

  let okClean = 0;
  let okWithWarnings = 0;
  const warnings: WarningRow[] = [];
  const failures: FailureRow[] = [];

  for (const file of files) {
    const content = readFileSync(join(KOANS_DIR, file), 'utf-8');
    const result = parseKoan(content, file);

    if (result.ok) {
      if (result.warnings.length === 0) {
        okClean++;
        continue;
      }
      okWithWarnings++;
      for (const w of result.warnings) {
        warnings.push({
          file,
          episode: result.koan.episodeNumber,
          warning: w,
          detail:
            w === 'incomplete_metadata'
              ? `missing csConceptEn (zh: "${result.koan.csConceptZh}")`
              : w === 'multiple_koan_h2'
                ? 'multiple 公案 H2 headings; used the first'
                : w,
        });
      }
    } else {
      failures.push({
        file,
        episode: null,
        reason: result.reason,
        ...(result.rawH1 ? { rawH1: result.rawH1 } : {}),
        ...(result.rawH2 ? { rawH2: result.rawH2 } : {}),
      });
    }
  }

  warnings.sort((a, b) => a.episode - b.episode || a.file.localeCompare(b.file));
  failures.sort((a, b) => a.file.localeCompare(b.file));

  const report = {
    ranAt: new Date().toISOString(),
    total: files.length,
    ok: okClean,
    okWithWarnings,
    failed: failures.length,
    warnings,
    failures,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(
    `${okClean}/${files.length} ok, ${okWithWarnings} with warnings, ${failures.length} failed. ` +
    `See ${REPORT_PATH}`,
  );
}

main();
