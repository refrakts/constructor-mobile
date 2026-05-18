/**
 * The single data seam (PLAN-02 / spec approach A). Screens depend ONLY on this
 * interface (via the queries hooks), never on a concrete impl. MockSessionGateway
 * implements it now; the real HTTP/WS gateway implements the same interface later
 * with zero screen changes. Typed entirely against the vendored protocol.
 */
import type {
  CreateSessionRequest,
  SandboxEvent,
  Session,
  SessionArtifact,
  SessionState,
} from '@constructor/protocol';

export type { CreateSessionRequest, SandboxEvent, Session, SessionArtifact, SessionState };

export interface SubscribeSnapshot {
  state: SessionState;
  artifacts: SessionArtifact[];
  replay: {
    events: SandboxEvent[];
    hasMore: boolean;
    cursor: { timestamp: number; id: string } | null;
  };
}

export interface StreamListeners {
  snapshot(s: SubscribeSnapshot): void;
  event(e: SandboxEvent): void;
  closed?(reason?: string): void;
}

export interface StreamHandle {
  unsubscribe(): void;
}

export interface ListSessionsResult {
  sessions: Session[];
  total: number;
  hasMore: boolean;
}

export interface SessionGateway {
  listSessions(): Promise<ListSessionsResult>;
  getSession(id: string): Promise<SessionState>;
  createSession(req: CreateSessionRequest): Promise<{ sessionId: string }>;
  /** Mirrors the real DO: a `snapshot` (state + replay) then a live event stream. */
  subscribe(id: string, on: StreamListeners): StreamHandle;
  sendFollowUp(id: string, content: string): Promise<void>;
  stop(id: string): Promise<void>;
}
