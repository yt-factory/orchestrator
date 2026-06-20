// Record selection for `make cost-dump` — extracted so it can be unit-tested
// without triggering cost-dump.ts's top-level main()/console output.
//
// The append-only call log can hold many runs. Default behavior is "latest run"
// = the records sharing the most-recent record's projectId. Flags override:
//   --all              every record
//   --project=<id>     one project
//   --since=<iso>      ts >= the given ISO timestamp

import type { LLMCallRecord } from '../llm/base/call-log';

export interface Selection {
  records: LLMCallRecord[];
  scope: string;
}

export function selectRecords(all: LLMCallRecord[], argv: string[]): Selection {
  if (argv.includes('--all')) return { records: all, scope: 'all logged calls' };

  const projectArg = argv.find((a) => a.startsWith('--project='))?.split('=')[1];
  if (projectArg) {
    return { records: all.filter((r) => r.projectId === projectArg), scope: `project ${projectArg}` };
  }

  const sinceArg = argv.find((a) => a.startsWith('--since='))?.split('=')[1];
  if (sinceArg) {
    return { records: all.filter((r) => r.ts >= sinceArg), scope: `since ${sinceArg}` };
  }

  // Default: latest run = records sharing the most-recent record's projectId.
  const lastWithProject = [...all].reverse().find((r) => r.projectId);
  if (lastWithProject?.projectId) {
    const pid = lastWithProject.projectId;
    return { records: all.filter((r) => r.projectId === pid), scope: `latest run (project ${pid})` };
  }
  return { records: all, scope: 'latest run (no projectId on records)' };
}
