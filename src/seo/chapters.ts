// Chapter extraction (Phase 5) — regex over timestamp markers. Never invents:
// if a source has no [MM:SS] / [HH:MM:SS] markers (the usual case before audio
// timing exists), returns '' and the caller logs a soft warning.

const CHAPTER_LINE = /^\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+(\S.*?)\s*$/gm;

/** Extract "MM:SS Title" lines from text. Returns '' when there are none. */
export function extractChapters(source: string): string {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  CHAPTER_LINE.lastIndex = 0;
  while ((match = CHAPTER_LINE.exec(source)) !== null) {
    out.push(`${match[1]} ${match[2]!.trim()}`);
  }
  return out.join('\n');
}
