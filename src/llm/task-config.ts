// Per-task output-token caps, keyed by the call-site `label` (CompleteOptions.label).
//
// The V4 cost investigation (Case A) confirmed DeepSeek `fast` tier ran thinking
// mode by default, spending ~71% of output tokens on reasoning. Disabling thinking
// is the primary fix; these caps are the belt-and-suspenders ceiling so a task can
// never run away on output regardless of provider behavior.
//
// Sizes are the rough JSON payload each task should produce. The label may carry a
// locale suffix (e.g. "faq:zh_TW"); we key on the prefix before ':'.

export const TASK_MAX_TOKENS: Record<string, number> = {
  topic: 200, // { "topic": "..." }
  facts: 800, // content-analyst: core_facts[] + key_entities[]
  trends: 300, // trending keyword list
  tags: 200, // { "tags": [...] }
  faq: 800, // { "faq": [{q,a,related_entities}, ...] }
  title: 50, // { "hook": "8-16 字" }
  description: 400, // { "hook_paragraph": "..." }
};

/**
 * Output-token cap for a task, or undefined if the label is unknown (no cap).
 * Keyed on the label prefix before ':' so locale-suffixed labels share a cap.
 */
export function maxTokensForTask(label: string | undefined): number | undefined {
  if (!label) return undefined;
  const key = label.split(':')[0] ?? label;
  return TASK_MAX_TOKENS[key];
}
