export interface CustomEventObservationTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface CustomEventObservationOptions {
  readonly eventType: string;
  readonly target?: CustomEventObservationTarget;
  readonly onEvent: (event: Event) => void;
}

/** Observe a caller-owned custom event without owning its payload or command policy. */
export function installCustomEventObservation(
  options: CustomEventObservationOptions,
): () => void {
  const target = options.target ?? (typeof window === 'undefined' ? undefined : window);
  if (!target) return () => {};

  let disposed = false;
  let registered = false;
  const listener: EventListener = (event) => {
    if (disposed) return;
    try { options.onEvent(event); } catch { /* caller command policy stays isolated */ }
  };

  try {
    // Occupy the registration before calling the host so register-then-throw
    // targets are still rolled back and retained listeners stay fenced.
    registered = true;
    target.addEventListener(options.eventType, listener);
  } catch {
    disposed = true;
    if (registered) {
      try { target.removeEventListener(options.eventType, listener); } catch { /* rollback continues */ }
    }
  }

  return () => {
    if (disposed) return;
    disposed = true;
    if (registered) {
      try { target.removeEventListener(options.eventType, listener); } catch { /* cleanup stays isolated */ }
    }
  };
}
