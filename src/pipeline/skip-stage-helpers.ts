// Empty-value factories for stages skipped under PIPELINE_MODE=seo_only.
//
// Skipped stages still write their manifest fields — as empty objects/arrays
// rather than missing — so downstream consumers (video-renderer, prepare-upload)
// never null-pointer, and re-enabling a stage needs no schema migration (D1).

import type { ScriptSegment, ShortsExtraction, VoicePersona, NotebookLMAudioConfig } from '../core/manifest';

export function skippedScript(): ScriptSegment[] {
  return [];
}

export function skippedShorts(): ShortsExtraction {
  return {
    hooks: [],
    vertical_crop_focus: null,
    recommended_music_mood: null,
    face_detection_hint: false,
  };
}

export function skippedVoice(): VoicePersona {
  return { provider: null, voice_id: null, style: null, language: null };
}

export function skippedAudio(): NotebookLMAudioConfig {
  return { source: null, languages: {} };
}
