export interface ViewportScrollEventTarget {
  addEventListener(type: 'scroll', listener: EventListener, capture: true): void;
  removeEventListener(type: 'scroll', listener: EventListener, capture: true): void;
}

export interface ViewportScrollObservationOptions {
  readonly target?: ViewportScrollEventTarget;
  readonly onScroll: () => void;
}

/** Observe descendant viewport scroll through the required capture phase. */
export function installViewportScrollObservation(
  options: ViewportScrollObservationOptions,
): () => void {
  const target = options.target ?? (typeof window === 'undefined' ? undefined : window);
  if (!target) return () => {};

  let disposed = false;
  let registered = false;
  const onScroll: EventListener = () => {
    if (disposed) return;
    try { options.onScroll(); } catch { /* caller geometry stays isolated */ }
  };

  try {
    // Occupy the registration before calling the host so register-then-throw
    // targets are still rolled back and retained listeners stay fenced.
    registered = true;
    target.addEventListener('scroll', onScroll, true);
  } catch {
    disposed = true;
    if (registered) {
      try { target.removeEventListener('scroll', onScroll, true); } catch { /* rollback continues */ }
    }
  }

  return () => {
    if (disposed) return;
    disposed = true;
    if (registered) {
      try { target.removeEventListener('scroll', onScroll, true); } catch { /* cleanup stays isolated */ }
    }
  };
}
