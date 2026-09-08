export interface WindowMessageEventTarget {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

export interface WindowMessageObservationOptions {
  readonly target?: WindowMessageEventTarget;
  readonly onMessage: (event: MessageEvent) => void;
}

/** Observe browser message delivery without owning origin, source, or payload policy. */
export function installWindowMessageObservation(
  options: WindowMessageObservationOptions,
): () => void {
  const defaultTarget = typeof window === 'undefined'
    ? undefined
    : window as unknown as WindowMessageEventTarget;
  const target = options.target ?? defaultTarget;
  if (!target) return () => {};

  let disposed = false;
  let registered = false;
  const listener = (event: MessageEvent) => {
    if (disposed) return;
    try { options.onMessage(event); } catch { /* caller trust and routing policy stays isolated */ }
  };

  try {
    // Occupy the registration before calling the host so register-then-throw
    // targets are still rolled back and retained listeners stay fenced.
    registered = true;
    target.addEventListener('message', listener);
  } catch {
    disposed = true;
    if (registered) {
      try { target.removeEventListener('message', listener); } catch { /* rollback continues */ }
    }
  }

  return () => {
    if (disposed) return;
    disposed = true;
    if (registered) {
      try { target.removeEventListener('message', listener); } catch { /* cleanup stays isolated */ }
    }
  };
}
