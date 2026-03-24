/**
 * CLI command: Channel Profile Management
 *
 * Manage channel profiles used by the orchestrator pipeline.
 *
 * Usage:
 *   bun run src/cli/channel.ts create <channel-id>   Create new profile from defaults
 *   bun run src/cli/channel.ts show <channel-id>     Show current profile
 *   bun run src/cli/channel.ts show                  Show default profile
 *   bun run src/cli/channel.ts list                  List all channel profiles
 */

import { readdir, stat, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  ChannelProfileManager,
  type ChannelProfile,
} from '../core/channel-profile';

// ============================================
// ANSI color helpers (no external deps)
// ============================================

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const WHITE = '\x1b[37m';

// ============================================
// Constants
// ============================================

const CHANNELS_DIR = './channels';

// ============================================
// Formatting Helpers
// ============================================

function printHeader(text: string): void {
  const line = '='.repeat(60);
  console.log(`\n${CYAN}${line}${RESET}`);
  console.log(`${CYAN}${BOLD}  ${text}${RESET}`);
  console.log(`${CYAN}${line}${RESET}\n`);
}

function printSection(title: string): void {
  console.log(`\n${MAGENTA}${BOLD}--- ${title} ---${RESET}\n`);
}

function printKeyValue(key: string, value: string | number): void {
  console.log(`  ${DIM}${key}:${RESET} ${WHITE}${value}${RESET}`);
}

function printList(items: readonly string[], color: string = WHITE): void {
  if (items.length === 0) {
    console.log(`  ${DIM}(none)${RESET}`);
    return;
  }
  for (const item of items) {
    console.log(`  ${color}- ${item}${RESET}`);
  }
}

// ============================================
// Title-Case Utility
// ============================================

function toTitleCase(id: string): string {
  return id
    .split(/[-_]/)
    .map((word) => {
      const first = word.charAt(0);
      const rest = word.slice(1);
      return first.toUpperCase() + rest.toLowerCase();
    })
    .join(' ');
}

// ============================================
// Command: create
// ============================================

async function commandCreate(channelId: string): Promise<void> {
  const profileDir = join(CHANNELS_DIR, channelId);
  const profilePath = join(profileDir, 'profile.json');

  // Check if file already exists
  try {
    await stat(profilePath);
    // If stat succeeds, file exists
    console.log(
      `\n  ${RED}Error: Profile already exists at ${profilePath}${RESET}`
    );
    console.log(
      `  ${DIM}Use "show ${channelId}" to view it, or edit the file directly.${RESET}\n`
    );
    process.exit(1);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      throw error;
    }
    // ENOENT means file doesn't exist -- proceed
  }

  const manager = new ChannelProfileManager(CHANNELS_DIR);
  const defaultProfile = manager.getDefaultProfile();

  const newProfile: ChannelProfile = {
    ...defaultProfile,
    channel_id: channelId,
    channel_name: toTitleCase(channelId),
  };

  await mkdir(profileDir, { recursive: true });
  await writeFile(profilePath, JSON.stringify(newProfile, null, 2) + '\n');

  printHeader('Channel Profile Created');
  printKeyValue('Channel ID', channelId);
  printKeyValue('Channel Name', newProfile.channel_name);
  printKeyValue('File', profilePath);
  console.log(
    `\n  ${YELLOW}Edit ${profilePath} to customize your channel profile.${RESET}\n`
  );
}

// ============================================
// Command: show
// ============================================

async function commandShow(channelId: string): Promise<void> {
  const manager = new ChannelProfileManager(CHANNELS_DIR);
  const profile = await manager.load(channelId);

  printHeader(`${profile.channel_name}`);

  // Tagline and basics
  console.log(`  ${CYAN}${profile.tagline}${RESET}`);
  console.log('');
  printKeyValue('Channel ID', profile.channel_id);
  printKeyValue('Niche', profile.niche);
  printKeyValue('Primary Language', profile.primary_language);
  if (profile.secondary_languages.length > 0) {
    printKeyValue(
      'Secondary Languages',
      profile.secondary_languages.join(', ')
    );
  }

  // Audience
  printSection('Audience');
  printKeyValue('Demographics', profile.audience.demographics);
  printKeyValue('Knowledge Level', profile.audience.knowledge_level);
  console.log(`\n  ${DIM}Pain Points:${RESET}`);
  printList(profile.audience.pain_points, YELLOW);
  console.log(`\n  ${DIM}Aspirations:${RESET}`);
  printList(profile.audience.aspirations, GREEN);

  // Voice
  printSection('Voice');
  printKeyValue('Tone', profile.voice.tone.join(', '));
  printKeyValue('Vocabulary Level', profile.voice.vocabulary_level);
  printKeyValue('Perspective', profile.voice.perspective);
  console.log(`\n  ${DIM}Example Phrases:${RESET}`);
  printList(profile.voice.example_phrases, CYAN);
  console.log(`\n  ${DIM}Forbidden Words:${RESET}`);
  printList(profile.voice.forbidden_words, RED);

  // Quality
  printSection('Quality');
  printKeyValue('Min Confidence Score', profile.quality.min_confidence_score);
  printKeyValue('Title Style', profile.quality.title_style);
  printKeyValue('Min Segment Count', profile.quality.min_segment_count);
  printKeyValue('Max Filler Ratio', profile.quality.max_filler_ratio);
  console.log(`\n  ${DIM}Required Elements:${RESET}`);
  printList(profile.quality.required_elements, WHITE);

  // SEO
  printSection('SEO');
  printKeyValue('Target Regions', profile.seo.target_regions.join(', '));
  printKeyValue('Keyword Style', profile.seo.keyword_style);
  console.log(`\n  ${DIM}Title Patterns:${RESET}`);
  printList(profile.seo.title_patterns, GREEN);
  console.log(`\n  ${DIM}Avoid Patterns:${RESET}`);
  printList(profile.seo.avoid_patterns, RED);

  // Content Formats
  printSection('Content Formats');
  if (profile.content_formats.length === 0) {
    console.log(`  ${DIM}(none defined)${RESET}`);
  } else {
    for (const format of profile.content_formats) {
      console.log(
        `  ${CYAN}${BOLD}${format.name}${RESET} ${DIM}(${format.format_id})${RESET}`
      );
      console.log(`    ${DIM}Structure:${RESET} ${WHITE}${format.structure}${RESET}`);
      console.log(`    ${DIM}Examples:${RESET}`);
      for (const topic of format.example_topics) {
        console.log(`      ${WHITE}- ${topic}${RESET}`);
      }
    }
  }

  console.log('');
}

// ============================================
// Command: list
// ============================================

async function commandList(): Promise<void> {
  printHeader('Channel Profiles');

  let entries: string[];
  try {
    entries = await readdir(CHANNELS_DIR);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      console.log(`  ${YELLOW}No channels directory found at ${CHANNELS_DIR}${RESET}\n`);
      return;
    }
    throw error;
  }

  const manager = new ChannelProfileManager(CHANNELS_DIR);
  let count = 0;

  for (const entry of entries) {
    const profilePath = join(CHANNELS_DIR, entry, 'profile.json');
    try {
      await stat(profilePath);
    } catch {
      // No profile.json in this directory -- skip
      continue;
    }

    const profile = await manager.load(entry);
    count++;
    console.log(
      `  ${CYAN}${BOLD}${profile.channel_id}${RESET}  ${DIM}-${RESET}  ${WHITE}${profile.channel_name}${RESET}`
    );
  }

  if (count === 0) {
    console.log(`  ${YELLOW}No channel profiles found.${RESET}`);
    console.log(
      `  ${DIM}Run "bun run channel create <channel-id>" to create one.${RESET}`
    );
  } else {
    console.log(
      `\n  ${DIM}${count} channel profile${count === 1 ? '' : 's'} found.${RESET}`
    );
  }

  console.log('');
}

// ============================================
// Usage
// ============================================

function printUsage(): void {
  console.log(`
${CYAN}${BOLD}Channel Profile Manager${RESET}

${DIM}Usage:${RESET}
  bun run channel create <channel-id>   ${DIM}Create new profile from defaults${RESET}
  bun run channel show <channel-id>     ${DIM}Show current profile${RESET}
  bun run channel show                  ${DIM}Show default profile${RESET}
  bun run channel list                  ${DIM}List all channel profiles${RESET}
`);
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const channelId = args[1];

  switch (command) {
    case 'create': {
      if (channelId == null || channelId.length === 0) {
        console.log(`\n  ${RED}Error: Missing channel-id${RESET}`);
        console.log(
          `  ${DIM}Usage: bun run channel create <channel-id>${RESET}\n`
        );
        process.exit(1);
      }
      await commandCreate(channelId);
      break;
    }

    case 'show': {
      const targetId = channelId ?? 'default';
      await commandShow(targetId);
      break;
    }

    case 'list': {
      await commandList();
      break;
    }

    default: {
      printUsage();
      if (command != null) {
        console.log(`  ${RED}Unknown command: ${command}${RESET}\n`);
        process.exit(1);
      }
      break;
    }
  }
}

main().catch((error: unknown) => {
  console.error(
    `${RED}Fatal error: ${(error as Error).message}${RESET}`
  );
  process.exit(1);
});
