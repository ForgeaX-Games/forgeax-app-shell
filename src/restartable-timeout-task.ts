export interface RestartableTimeoutTaskLifecycleOptions {
  readonly task: () => void;
  readonly delayMs: number;
  readonly setTimeout?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

export interface RestartableTimeoutTaskLifecycle {
  /** Replace any pending task with a fresh timeout using the caller's delay. */
  schedule(): void;
  /** Cancel pending work without disposing the lifecycle. */
  cancel(): void;
  dispose(): void;
}

interface PendingTimeout {
  hasHandle: boolean;
  handle?: unknown;
  ran: boolean;
}

/**
 * Own one restartable timeout, not the caller's delayed action or timing policy.
 * Cancellation/disposal fence retained callbacks even when host cleanup fails.
 */
export function createRestartableTimeoutTaskLifecycle(
  options: RestartableTimeoutTaskLifecycleOptions,
): RestartableTimeoutTaskLifecycle {
  const request = options.setTimeout ?? (
    typeof setTimeout === 'undefined' ? undefined : setTimeout.bind(globalThis)
  );
  const clear = options.clearTimeout ?? (
    typeof clearTimeout === 'undefined'
      ? undefined
      : (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  );
  let disposed = false;
  let generation = 0;
  let pending: PendingTimeout | undefined;

  const clearHandle = (handle: unknown): void => {
    try { clear?.(handle); } catch { /* host cleanup stays isolated */ }
  };
  const releasePending = (): void => {
    const previous = pending;
    pending = undefined;
    if (previous?.hasHandle) clearHandle(previous.handle);
  };
  const cancel = (): void => {
    generation++;
    releasePending();
  };

  return {
    schedule() {
      if (disposed || !request) return;
      const currentGeneration = ++generation;
      releasePending();
      // Host cleanup may synchronously cancel, dispose, or schedule a successor.
      if (disposed || currentGeneration !== generation) return;
      const current: PendingTimeout = { hasHandle: false, ran: false };
      pending = current;
      let handle: unknown;
      try {
        handle = request(() => {
          current.ran = true;
          if (disposed || pending !== current) return;
          pending = undefined;
          generation++;
          try { options.task(); } catch { /* caller action stays isolated */ }
        }, options.delayMs);
      } catch {
        // A scheduler can retain a callback and then throw without giving a handle.
        if (pending === current) {
          pending = undefined;
          generation++;
        }
        return;
      }
      if (current.ran) return;
      if (disposed || pending !== current) {
        clearHandle(handle);
        return;
      }
      current.handle = handle;
      current.hasHandle = true;
    },
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
    },
  };
}
