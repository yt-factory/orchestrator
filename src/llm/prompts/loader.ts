// Prompt loader (Phase 4) — reads externalized prompt files and renders them.
//
// Each prompt is a pair under orchestrator/prompts/:
//   {name}.system.md  — frontmatter (version, description) + system-prompt body
//   {name}.user.j2    — Nunjucks template for the variable user content
//
// loadPrompt() returns the rendered { system, user } plus the system file's
// `version`, which the caller passes as CompleteOptions.templateVersion to drive
// cache invalidation. throwOnUndefined makes a missing template variable fail
// loudly rather than silently render blank.

import nunjucks from 'nunjucks';
import { readFileSync } from 'fs';
import { join } from 'path';
import { s2tw } from '../../templates/filters';

const PROMPTS_DIR = join(import.meta.dir, '../../../prompts');

const env = nunjucks.configure(PROMPTS_DIR, {
  autoescape: false,
  throwOnUndefined: true,
  trimBlocks: true,
  lstripBlocks: true,
});

// zh_TW description templates convert Simplified koan names/tags to Traditional.
env.addFilter('toTraditional', (text: string) => s2tw(text));

export interface LoadedPrompt {
  system: string;
  user: string;
  version: number;
}

interface ParsedFrontmatter {
  version: number;
  body: string;
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { version: 0, body: raw };
  }
  const [, frontmatter, body] = match;
  const versionMatch = frontmatter!.match(/^version:\s*(\d+)/m);
  return {
    version: versionMatch ? parseInt(versionMatch[1]!, 10) : 0,
    body: body ?? '',
  };
}

/**
 * Load and render a prompt pair. `name` is the path under prompts/ without
 * extension, e.g. "seo/content-analyst".
 */
export function loadPrompt(name: string, vars: Record<string, unknown> = {}): LoadedPrompt {
  const systemRaw = readFileSync(join(PROMPTS_DIR, `${name}.system.md`), 'utf-8');
  const { version, body } = parseFrontmatter(systemRaw);

  // Render both through the configured env so {% include %} of _shared/ works.
  const system = env.renderString(body, vars).trim();
  const user = env.render(`${name}.user.j2`, vars).trim();

  return { system, user, version };
}

/** Render a standalone Nunjucks template (no system/user split, no LLM). */
export function renderTemplate(templatePath: string, vars: Record<string, unknown> = {}): string {
  return env.render(templatePath, vars).trim();
}
