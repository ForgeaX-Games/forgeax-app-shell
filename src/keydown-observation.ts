export interface KeydownEventTarget {
  addEventListener(
    type: 'keydown',
    listener: (event: KeyboardEvent) => void,
    capture?: boolean,
  ): void;
  removeEventListener(
    type: 'keydown',
    listener: (event: KeyboardEvent) => void,
    capture?: boolean,
  ): void;
}

export interface KeydownObservationOptions {
  readonly target?: KeydownEventTarget;
  readonly capture?: boolean;
  readonly onKeyDown: (event: KeyboardEvent) => void;
}

/** Observe keydown delivery without owning keyboard routing or command policy. */
export function installKeydownObservation(
  options: KeydownObservationOptions,
): () => void {
  const defaultTarget = typeof window === 'undefined'
    ? undefined
    : window as unknown as KeydownEventTarget;
  const target = options.target ?? defaultTarget;
  if (!target) return () => {};

  const capture = options.capture === true;
  let disposed = false;
  let registered = false;
  const listener = (event: KeyboardEvent): void => {
    if (disposed) return;
    try { options.onKeyDown(event); } catch { /* caller keyboard policy stays isolated */ }
  };

  try {
    // Occupy the registration before calling the host so register-then-throw
    // targets are still rolled back and retained listeners stay fenced.
    registered = true;
    target.addEventListener('keydown', listener, capture);
  } catch {
    disposed = true;
    if (registered) {
      try { target.removeEventListener('keydown', listener, capture); } catch { /* rollback continues */ }
    }
  }

  return () => {
    if (disposed) return;
    disposed = true;
    if (registered) {
      try { target.removeEventListener('keydown', listener, capture); } catch { /* cleanup stays isolated */ }
    }
  };
}
