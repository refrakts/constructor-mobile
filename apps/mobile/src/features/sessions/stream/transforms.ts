/**
 * Ported from background-agents/packages/web/src/hooks/use-session-socket.ts
 * lines 64-100 (collapseTokenEvents) and 250-297 (processSandboxEvent rule)
 * @ a7b968f3dfc7ff4d3d92fc158d57834c100e453c — PURE logic only, no React/DOM.
 *
 * Semantics (PLAN-02 / 03-data-plane): `token` events are cumulative (each
 * carries the full accumulated text); only the last token before
 * `execution_complete` is kept, emitted with the token's original timestamp.
 */
import type { SandboxEvent } from '@constructor/protocol';

export interface PendingToken {
  content: string;
  messageId: string;
  sandboxId: string;
  timestamp: number;
}
/** Mutable holder (the upstream `pendingTextRef` — a plain box, kept pure). */
export type PendingRef = { current: PendingToken | null };

export function collapseTokenEvents(events: SandboxEvent[], pending: PendingRef): SandboxEvent[] {
  const result: SandboxEvent[] = [];
  for (const evt of events) {
    if (evt.type === 'token' && evt.content && evt.messageId) {
      pending.current = {
        content: evt.content,
        messageId: evt.messageId,
        sandboxId: evt.sandboxId,
        timestamp: evt.timestamp,
      };
    } else if (evt.type === 'execution_complete') {
      if (pending.current) {
        const p = pending.current;
        pending.current = null;
        result.push({
          type: 'token',
          content: p.content,
          messageId: p.messageId,
          sandboxId: p.sandboxId,
          timestamp: p.timestamp,
        });
      }
      result.push(evt);
    } else {
      result.push(evt);
    }
  }
  return result;
}

/**
 * Pure equivalent of upstream `processSandboxEvent` (which used setState):
 * fold one live event into the prior event list using the same rule.
 */
export function foldEvent(prev: SandboxEvent[], event: SandboxEvent, pending: PendingRef): SandboxEvent[] {
  if (event.type === 'token' && event.content && event.messageId) {
    pending.current = {
      content: event.content,
      messageId: event.messageId,
      sandboxId: event.sandboxId,
      timestamp: event.timestamp,
    };
    return prev;
  }
  if (event.type === 'execution_complete') {
    const out = [...prev];
    if (pending.current) {
      const p = pending.current;
      pending.current = null;
      out.push({
        type: 'token',
        content: p.content,
        messageId: p.messageId,
        sandboxId: p.sandboxId,
        timestamp: p.timestamp,
      });
    }
    out.push(event);
    return out;
  }
  return [...prev, event];
}

/** Pure cost accumulation (upstream folded this into sessionState on step_finish). */
export function costDelta(event: SandboxEvent): number {
  if (event.type === 'step_finish' && typeof event.cost === 'number' && Number.isFinite(event.cost) && event.cost > 0) {
    return event.cost;
  }
  return 0;
}
