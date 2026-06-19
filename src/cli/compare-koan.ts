// Compare tool (Phase 6) — produce a fresh SEO manifest for one koan and, if a
// baseline manifest is present, a side-by-side diff. A monthly debug aid.
//
//   make compare KOAN=ep48   ->   bun run src/cli/compare-koan.ts ep48
//
// Safe by construction: snapshots the mutable data files, empties the hash cache
// so the koan reprocesses, runs the pipeline once (LLM_PROVIDER from .env), then
// RESTORES everything. It never deletes from processed/ (the watcher moves the
// staged copy back there intact). Drop a pre-refactor manifest at
// .compare/{koan}/baseline.manifest.json to get .compare/{koan}/diff.md.

import {
  readdirSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, rmSync,
} from 'fs';
import { join, basename } from 'path';

const PROCESSED = './processed';
const INCOMING = './incoming';
const DATA = './data';
const AP = './active_projects';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: bun run src/cli/compare-koan.ts <koan>   (e.g. ep48)');
  process.exit(1);
}

const koanFile = readdirSync(PROCESSED).find(
  (f) => f.endsWith('.md') && (f === `${arg}.md` || f.startsWith(`${arg}_`) || f.startsWith(`${arg}.`)),
);
if (!koanFile) {
  console.error(`koan not found in ${PROCESSED}: ${arg}`);
  process.exit(1);
}
const koanName = koanFile.replace(/\.md$/, '');
const outDir = join('.compare', koanName);

const readOrNull = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf-8') : null);
const restore = (p: string, v: string | null): void => {
  if (v !== null) writeFileSync(p, v);
};

const hashesBak = readOrNull(`${DATA}/processed_hashes.json`);
const costBak = readOrNull(`${DATA}/cost_report.json`);
const trendsBak = readOrNull(`${DATA}/trends_authority.json`);
const apBefore = new Set(readdirSync(AP));

function pickRegion(seo: any, lang: string): any {
  return seo?.regional_seo?.find((r: any) => r.language === lang) ?? seo?.regional_seo?.[0] ?? {};
}

function writeDiff(baselinePath: string, newPath: string, diffPath: string): void {
  const b = JSON.parse(readFileSync(baselinePath, 'utf-8'));
  const n = JSON.parse(readFileSync(newPath, 'utf-8'));
  const bs = b.content_engine?.seo;
  const ns = n.content_engine?.seo;
  const titles = (s: any): string =>
    (s?.regional_seo ?? []).map((r: any) => `- [${r.language}] ${r.titles.join(' | ')}`).join('\n');
  const md = [
    `# Compare: ${koanName}`, '',
    '## Titles', '### baseline', titles(bs) || '(none)', '', '### new', titles(ns) || '(none)', '',
    '## Description (zh)', '### baseline', '```', pickRegion(bs, 'zh').description ?? '(none)', '```',
    '### new', '```', pickRegion(ns, 'zh').description ?? '(none)', '```', '',
    '## Tags', '### baseline', (bs?.tags ?? []).join(', ') || '(none)',
    '', '### new', (ns?.tags ?? []).join(', ') || '(none)', '',
  ].join('\n');
  writeFileSync(diffPath, md);
}

try {
  writeFileSync(`${DATA}/processed_hashes.json`, '[]'); // force reprocess
  copyFileSync(join(PROCESSED, koanFile), join(INCOMING, koanFile));

  const proc = Bun.spawnSync(['bun', 'run', 'src/index.ts', '--once'], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  });
  if (proc.exitCode !== 0) console.error(`(pipeline exited ${proc.exitCode})`);

  const newDirs = readdirSync(AP).filter((d) => !apBefore.has(d));
  let manifestPath: string | null = null;
  for (const d of newDirs) {
    const mp = join(AP, d, 'manifest.json');
    if (!existsSync(mp)) continue;
    const m = JSON.parse(readFileSync(mp, 'utf-8'));
    if (basename(m.input_source?.local_path ?? '') === koanFile) {
      manifestPath = mp;
      break;
    }
  }
  if (!manifestPath && newDirs.length > 0) manifestPath = join(AP, newDirs[0]!, 'manifest.json');

  mkdirSync(outDir, { recursive: true });
  if (manifestPath && existsSync(manifestPath)) {
    const newOut = join(outDir, 'new.manifest.json');
    copyFileSync(manifestPath, newOut);
    console.log(`wrote ${newOut}`);
    const baselinePath = join(outDir, 'baseline.manifest.json');
    if (existsSync(baselinePath)) {
      writeDiff(baselinePath, newOut, join(outDir, 'diff.md'));
      console.log(`wrote ${join(outDir, 'diff.md')}`);
    } else {
      console.log(`(no ${baselinePath} — drop a pre-refactor manifest there to get diff.md)`);
    }
  } else {
    console.error('no new manifest produced (parse skip? pipeline failure?) — see output above');
  }

  for (const d of newDirs) rmSync(join(AP, d), { recursive: true, force: true });
} finally {
  restore(`${DATA}/processed_hashes.json`, hashesBak);
  restore(`${DATA}/cost_report.json`, costBak);
  restore(`${DATA}/trends_authority.json`, trendsBak);
  try {
    rmSync(join(INCOMING, koanFile), { force: true });
  } catch {
    /* watcher already moved it back to processed/ */
  }
}
