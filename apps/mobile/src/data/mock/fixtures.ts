/**
 * Mock fixtures shaped to the real vendored protocol. The scripted scenario
 * mirrors the real DO contract: a `snapshot` (state + replay) then a live
 * `SandboxEvent` stream, so screens behave as they will post-M0 (spec §5).
 * Enum literals are `satisfies`-checked against @constructor/protocol.
 */
import type { SandboxEvent, Session, SessionState } from '@constructor/protocol';

const now = Date.now();
const SBX = 'sbx_mock_1';

export const mockSessions: Session[] = [
  {
    id: 's_active',
    title: 'Add dark-mode toggle to settings',
    repoOwner: 'refrakts',
    repoName: 'constructor-mobile',
    baseBranch: 'main',
    branchName: 'open-inspect/s_active',
    baseSha: 'abc1234',
    currentSha: 'def5678',
    opencodeSessionId: null,
    status: 'active',
    parentSessionId: null,
    spawnSource: 'user',
    spawnDepth: 0,
    createdAt: now - 1000 * 60 * 12,
    updatedAt: now - 1000 * 30,
  },
  {
    id: 's_done',
    title: 'Fix flaky auth test',
    repoOwner: 'refrakts',
    repoName: 'constructor-mobile',
    baseBranch: 'main',
    branchName: 'open-inspect/s_done',
    baseSha: 'aaa0001',
    currentSha: 'bbb0002',
    opencodeSessionId: null,
    status: 'completed',
    parentSessionId: null,
    spawnSource: 'user',
    spawnDepth: 0,
    createdAt: now - 1000 * 60 * 60 * 5,
    updatedAt: now - 1000 * 60 * 60 * 4,
  },
] satisfies Session[];

export function mockSessionState(id: string): SessionState {
  const src = mockSessions.find((x) => x.id === id) ?? mockSessions[0];
  return {
    id: src.id,
    title: src.title,
    repoOwner: src.repoOwner,
    repoName: src.repoName,
    baseBranch: src.baseBranch,
    branchName: src.branchName,
    status: src.status,
    sandboxStatus: 'running',
    messageCount: 1,
    createdAt: src.createdAt,
    model: 'anthropic/claude-sonnet-4-6',
    isProcessing: src.status === 'active',
    totalCost: 0,
  } satisfies SessionState;
}

/** Scenario A — happy path: prompt → tool → cumulative token stream → done. */
export function scenarioHappy(): SandboxEvent[] {
  const t = () => Date.now() / 1000;
  const mid = 'm_1';
  const partials = [
    'Looking at the settings screen…',
    'Looking at the settings screen… adding a `Toggle`',
    'Looking at the settings screen… adding a `Toggle` bound to the theme store.',
    'Looking at the settings screen… adding a `Toggle` bound to the theme store.\n\n```tsx\n<Toggle value={dark} onValueChange={setDark} />\n```\n\nDone.',
  ];
  const evts: SandboxEvent[] = [
    { type: 'user_message', content: 'Add a dark-mode toggle to the settings screen', messageId: mid, timestamp: t() },
    { type: 'step_start', messageId: mid, sandboxId: SBX, timestamp: t() },
    { type: 'tool_call', tool: 'read_file', args: { path: 'src/app/settings.tsx' }, callId: 'c1', messageId: mid, sandboxId: SBX, timestamp: t() },
    { type: 'tool_result', callId: 'c1', result: 'export default function Settings() { … }', messageId: mid, sandboxId: SBX, timestamp: t() },
  ];
  for (const p of partials) {
    evts.push({ type: 'token', content: p, messageId: mid, sandboxId: SBX, timestamp: t() });
  }
  evts.push({ type: 'step_finish', cost: 0.0123, tokens: 1840, messageId: mid, sandboxId: SBX, timestamp: t() });
  evts.push({ type: 'execution_complete', messageId: mid, success: true, sandboxId: SBX, timestamp: t() });
  return evts;
}

/** Scenario B — error path. */
export function scenarioError(): SandboxEvent[] {
  const t = () => Date.now() / 1000;
  const mid = 'm_err';
  return [
    { type: 'user_message', content: 'Refactor the auth module', messageId: mid, timestamp: t() },
    { type: 'step_start', messageId: mid, sandboxId: SBX, timestamp: t() },
    { type: 'tool_call', tool: 'run_tests', args: {}, callId: 'c9', messageId: mid, sandboxId: SBX, timestamp: t() },
    { type: 'error', error: 'Test suite failed: 3 failing in auth.test.ts', messageId: mid, sandboxId: SBX, timestamp: t() },
    { type: 'execution_complete', messageId: mid, success: false, error: 'aborted', sandboxId: SBX, timestamp: t() },
  ];
}
