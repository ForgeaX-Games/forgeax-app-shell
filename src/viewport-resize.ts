export interface ViewportResizeEventTarget {
  addEventListener(type: 'resize', listener: EventListener): void;
  removeEventListener(type: 'resize', listener: EventListener): void;
}

export interface ViewportResizeObservationOptions {
  readonly target?: ViewportResizeEventTarget;
  readonly onResize: () => void;
}

/** Observe viewport resize without owning the caller's geometry policy. */
export function installViewportResizeObservation(
  options: ViewportResizeObservationOptions,
): () => void {
  const target = options.target ?? (typeof window === 'undefined' ? undefined : window);
  if (!target) return () => {};

  let disposed = false;
  let registered = false;
  const onResize: EventListener = () => {
    if (disposed) return;
    try { options.onResize(); } catch { /* caller geometry stays isolated */ }
  };

  try {
    // Occupy the registration before calling the host so register-then-throw
    // targets are still rolled back and retained listeners stay fenced.
    registered = true;
    target.addEventListener('resize', onResize);
  } catch {
    disposed = true;
    if (registered) {
      try { target.removeEventListener('resize', onResize); } catch { /* rollback continues */ }
    }
  }

  return () => {
    if (disposed) return;
    disposed = true;
    if (registered) {
      try { target.removeEventListener('resize', onResize); } catch { /* cleanup stays isolated */ }
    }
  };
}
