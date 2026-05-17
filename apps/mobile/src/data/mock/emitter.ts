/** Replays a scripted SandboxEvent[] through stream listeners with realistic
 *  inter-event timing. Returns a cancel fn (clears pending timers). */
import type { SandboxEvent } from '@constructor/protocol';

import type { StreamListeners, SubscribeSnapshot } from '../gateway';

export function startScriptedStream(
  snapshot: SubscribeSnapshot,
  script: SandboxEvent[],
  on: StreamListeners,
): () => void {
  let cancelled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];

  // snapshot first (mirrors `subscribed` frame), then stream after a beat.
  const snapTimer = setTimeout(() => {
    if (cancelled) return;
    on.snapshot(snapshot);
    let delay = 350;
    script.forEach((evt) => {
      delay += evt.type === 'token' ? 90 : 260;
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          on.event(evt);
        }, delay),
      );
    });
    timers.push(
      setTimeout(() => {
        if (!cancelled) on.closed?.('completed');
      }, delay + 200),
    );
  }, 200);
  timers.push(snapTimer);

  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
  };
}
