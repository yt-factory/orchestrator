// Single source of truth for DeepSeek model ids and pricing.
//
// VERIFIED FROM https://api-docs.deepseek.com/quick_start/pricing on 2026-06-18.
// Prices are USD per 1M tokens. The deprecated aliases `deepseek-chat` and
// `deepseek-reasoner` retire 2026-07-24 15:59 UTC — we use the new ids directly.
//
// Both models: 1M context, up to 384K max output, JSON output + tool calling,
// and support thinking / non-thinking modes (we use non-thinking by default).

export const DEEPSEEK_MODELS = {
  fast: {
    id: 'deepseek-v4-flash',
    inputPerM: 0.14, // cache miss
    cachedInputPerM: 0.0028, // cache hit (98% discount — the prefix-cache win)
    outputPerM: 0.28,
    supportsThinking: true,
  },
  smart: {
    id: 'deepseek-v4-pro',
    inputPerM: 0.435, // cache miss
    cachedInputPerM: 0.003625, // cache hit
    outputPerM: 0.87,
    supportsThinking: true,
  },
} as const;

export type DeepSeekTierConfig = (typeof DEEPSEEK_MODELS)[keyof typeof DEEPSEEK_MODELS];
