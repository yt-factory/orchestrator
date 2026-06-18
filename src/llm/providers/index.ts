// Provider factory — resolves the active LLM provider by name.
//
// Selection order: explicit arg > LLM_PROVIDER env > "gemini".
// DeepSeek is registered in a later commit; until then requesting it fails
// loudly rather than silently falling back.

import { BaseLLMProvider } from '../base/provider';
import { GeminiProvider } from './gemini';
import type { CostTracker } from '../base/cost-tracker';

export interface GetProviderOptions {
  /** Shared cost tracker injected into the provider (see ProviderConfig). */
  costTracker?: CostTracker;
}

export function getProvider(name?: string, opts: GetProviderOptions = {}): BaseLLMProvider {
  const resolved = (name ?? process.env.LLM_PROVIDER ?? 'gemini').toLowerCase();

  switch (resolved) {
    case 'gemini':
      return new GeminiProvider(opts);
    case 'deepseek':
      throw new Error(
        "LLM_PROVIDER='deepseek' is not available yet (added in a later commit). " +
        "Use LLM_PROVIDER=gemini for now.",
      );
    default:
      throw new Error(`Unknown LLM_PROVIDER '${resolved}'. Supported: gemini.`);
  }
}

export { BaseLLMProvider };
