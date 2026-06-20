// `make seo` — print copy-paste-ready SEO for the latest (or a chosen) project.
//
//   bun run print-seo                 # human format, zh_TW
//   LOCALE=zh_CN_XHS bun run print-seo
//   bun run print-seo --json          # machine format
//   bun run print-seo --project=<id>  # a specific project
//
// Replaces the old inline-Python `make seo`, which printed only zh title +
// description + tags. This prints title, description, tags, FAQ, and cost, in
// the requested locale.

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import type { ProjectManifest } from '../core/manifest';

const PROJECTS_DIR = process.env.ACTIVE_PROJECTS_DIR ?? 'active_projects';

function fail(message: string): never {
  console.error(`make seo: ${message}`);
  process.exit(1);
}

function findLatestProject(): string {
  if (!existsSync(PROJECTS_DIR)) fail(`no ${PROJECTS_DIR}/ directory`);
  const dirs = readdirSync(PROJECTS_DIR)
    .filter((d) => existsSync(join(PROJECTS_DIR, d, 'manifest.json')))
    .map((d) => ({ d, mtime: statSync(join(PROJECTS_DIR, d, 'manifest.json')).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (dirs.length === 0) fail('no projects with a manifest.json found — run `make process` first');
  return dirs[0]!.d;
}

function loadManifest(projectId: string): ProjectManifest {
  const path = join(PROJECTS_DIR, projectId, 'manifest.json');
  if (!existsSync(path)) fail(`project not found: ${projectId}`);
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ProjectManifest;
  } catch (error) {
    return fail(`could not read manifest for ${projectId}: ${String(error)}`);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const locale = (process.env.LOCALE ?? 'zh_TW').trim();
  const format = args.includes('--json') ? 'json' : 'human';
  const projectIdArg = args.find((a) => a.startsWith('--project='))?.split('=')[1];

  const projectId = projectIdArg ?? findLatestProject();
  const manifest = loadManifest(projectId);

  const seo = manifest.content_engine?.seo;
  if (!seo) fail(`project ${projectId} has no content_engine.seo (failed or skipped?)`);

  const regional = seo.regional_seo.find((r) => r.language === locale);
  if (!regional) {
    fail(
      `locale "${locale}" not in manifest; available: ${seo.regional_seo.map((r) => r.language).join(', ')}`,
    );
  }
  const cost = manifest.meta.cost;

  if (format === 'json') {
    console.log(JSON.stringify({
      project_id: projectId,
      locale,
      title: regional.titles[0],
      description: regional.description,
      tags: seo.tags,
      faq: seo.faq_structured_data,
      cost,
    }, null, 2));
    return;
  }

  const sep = '═'.repeat(60);
  const out: string[] = [];
  out.push(`Project: ${projectId}`);
  out.push(`Locale:  ${locale}`);
  out.push('');
  out.push(sep, '📺  YOUTUBE TITLE', sep, regional.titles[0] ?? '(none)', '');
  out.push(sep, '📝  DESCRIPTION (copy-paste to YouTube)', sep, regional.description, '');
  out.push(sep, `🏷️   TAGS (${seo.tags.length})`, sep, seo.tags.join(', '), '');

  if (seo.faq_structured_data && seo.faq_structured_data.length > 0) {
    out.push(sep, `❓  FAQ (${seo.faq_structured_data.length}) — pinned comment / description bottom`, sep);
    seo.faq_structured_data.forEach((faq, i) => {
      out.push(`Q${i + 1}: ${faq.question}`, `A${i + 1}: ${faq.answer}`, '');
    });
  }

  out.push('─'.repeat(60));
  out.push(`💰  Cost: $${cost.estimated_cost_usd.toFixed(4)} | ${cost.total_tokens_used} tokens | ${cost.api_calls_count} API calls`);
  out.push('─'.repeat(60));

  console.log(out.join('\n'));
}

main();
