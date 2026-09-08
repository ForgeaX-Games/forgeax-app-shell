export interface IntervalTaskLifecycleOptions {
  readonly task: () => void;
  readonly intervalMs: number;
  readonly setInterval?: (callback: () => void, intervalMs: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
}

export interface IntervalTaskLifecycle {
  /** Register once, after the caller has stored this lifecycle's ownership. */
  start(): void;
  /** Terminal, idempotent cleanup; retained callbacks cannot run caller work. */
  dispose(): void;
}

/** Own one native fixed interval, not polling, retry, or asynchronous work policy. */
export function createIntervalTaskLifecycle(
  options: IntervalTaskLifecycleOptions,
): IntervalTaskLifecycle {
  const register = options.setInterval ?? (
    typeof setInterval === 'undefined' ? undefined : setInterval.bind(globalThis)
  );
  const clear = options.clearInterval ?? (
    typeof clearInterval === 'undefined'
      ? undefined
      : (handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>)
  );
  let started = false;
  let disposed = false;
  let hasHandle = false;
  let handle: unknown;
  const clearHandle = (value: unknown): void => {
    try { clear?.(value); } catch { /* host cleanup stays isolated */ }
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (!hasHandle) return;
    hasHandle = false;
    clearHandle(handle);
  };

  return {
    start() {
      if (started || disposed) return;
      started = true;
      if (!register) return;
      let registeredHandle: unknown;
      try {
        registeredHandle = register(() => {
          if (disposed) return;
          try { options.task(); } catch { /* one failed tick cannot stop later ticks */ }
        }, options.intervalMs);
      } catch {
        // No handle exists to clear if registration retains a callback then throws.
        dispose();
        return;
      }
      // A synchronous registration tick may dispose before the handle is returned.
      if (disposed) clearHandle(registeredHandle);
      else {
        handle = registeredHandle;
        hasHandle = true;
      }
    },
    dispose,
  };
}
