/** In-memory SessionGateway. Same interface the real HTTP/WS gateway will
 *  implement later — screens never know which one is wired. */
import type { CreateSessionRequest, Session, SessionState } from '@constructor/protocol';

import type { SessionGateway, StreamHandle, StreamListeners, SubscribeSnapshot } from '../gateway';
import { startScriptedStream } from './emitter';
import { mockSessionState, mockSessions, scenarioError, scenarioHappy } from './fixtures';

export class MockSessionGateway implements SessionGateway {
  private sessions: Session[] = [...mockSessions];

  async listSessions(): Promise<Session[]> {
    await tick();
    return [...this.sessions];
  }

  async getSession(id: string): Promise<SessionState> {
    await tick();
    return mockSessionState(id);
  }

  async createSession(req: CreateSessionRequest): Promise<{ sessionId: string }> {
    await tick();
    const id = `s_${Math.random().toString(36).slice(2, 8)}`;
    const ts = Date.now();
    this.sessions = [
      {
        id,
        title: req.title ?? `${req.repoOwner}/${req.repoName}`,
        repoOwner: req.repoOwner,
        repoName: req.repoName,
        baseBranch: req.branch ?? 'main',
        branchName: `open-inspect/${id}`,
        baseSha: null,
        currentSha: null,
        opencodeSessionId: null,
        status: 'active',
        parentSessionId: null,
        spawnSource: 'user',
        spawnDepth: 0,
        createdAt: ts,
        updatedAt: ts,
      },
      ...this.sessions,
    ];
    return { sessionId: id };
  }

  subscribe(id: string, on: StreamListeners): StreamHandle {
    const state = mockSessionState(id);
    const snapshot: SubscribeSnapshot = {
      state,
      artifacts: [],
      replay: { events: [], hasMore: false, cursor: null },
    };
    const script = state.status === 'failed' ? scenarioError() : scenarioHappy();
    const cancel = startScriptedStream(snapshot, script, on);
    return { unsubscribe: cancel };
  }

  async sendFollowUp(_id: string, _content: string): Promise<void> {
    await tick();
  }

  async stop(_id: string): Promise<void> {
    await tick();
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 220));
