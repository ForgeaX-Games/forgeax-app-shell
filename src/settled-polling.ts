export interface SettledPollingLifecycleOptions {
  readonly task: (signal: AbortSignal) => Promise<void>;
  readonly intervalMs: number;
  readonly timeoutMs?: number;
  readonly maxBackoffMs?: number;
  readonly isVisible?: () => boolean;
  readonly setTimeout?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
  readonly createAbortController?: () => AbortController;
}

export interface SettledPollingLifecycle {
  /** Run the first attempt immediately; later attempts wait for settlement. */
  start(): void;
  /** Terminal, idempotent cleanup; pending and in-flight work is fenced. */
  dispose(): void;
}

interface PendingTimer {
  active: boolean;
  ran: boolean;
  hasHandle: boolean;
  handle?: unknown;
}

interface PollAttempt {
  readonly controller: AbortController;
  deadline?: PendingTimer;
}

/**
 * Own one visibility-aware settled poll with an abort deadline and bounded
 * failure backoff. Products retain request, result, and presentation policy.
 */
export function createSettledPollingLifecycle(
  options: SettledPollingLifecycleOptions,
): SettledPollingLifecycle {
  const request = options.setTimeout ?? (
    typeof setTimeout === 'undefined' ? undefined : setTimeout.bind(globalThis)
  );
  const clear = options.clearTimeout ?? (
    typeof clearTimeout === 'undefined'
      ? undefined
      : (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  );
  const createController = options.createAbortController ?? (() => new AbortController());
  const isVisible = options.isVisible ?? (
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  );
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxBackoffMs = options.maxBackoffMs ?? 30_000;
  let started = false;
  let disposed = false;
  let failures = 0;
  let pending: PendingTimer | undefined;
  let attempt: PollAttempt | undefined;

  const clearHandle = (handle: unknown): void => {
    try { clear?.(handle); } catch { /* host cleanup stays isolated */ }
  };
  const releaseTimer = (timer: PendingTimer | undefined): void => {
    if (!timer || !timer.active) return;
    timer.active = false;
    if (timer.hasHandle) clearHandle(timer.handle);
  };
  const abort = (controller: AbortController): void => {
    try { controller.abort(); } catch { /* host abort stays isolated */ }
  };

  const scheduleDeadline = (current: PollAttempt): void => {
    if (!request || disposed || attempt !== current) return;
    const timer: PendingTimer = { active: true, ran: false, hasHandle: false };
    current.deadline = timer;
    let handle: unknown;
    try {
      handle = request(() => {
        timer.ran = true;
        if (disposed || attempt !== current || current.deadline !== timer || !timer.active) return;
        timer.active = false;
        current.deadline = undefined;
        abort(current.controller);
      }, timeoutMs);
    } catch {
      if (current.deadline === timer) current.deadline = undefined;
      timer.active = false;
      return;
    }
    if (timer.ran) return;
    if (disposed || attempt !== current || current.deadline !== timer || !timer.active) {
      clearHandle(handle);
      return;
    }
    timer.handle = handle;
    timer.hasHandle = true;
  };

  let run: () => Promise<void>;
  const schedule = (delayMs: number): void => {
    if (!request || disposed) return;
    const timer: PendingTimer = { active: true, ran: false, hasHandle: false };
    pending = timer;
    let handle: unknown;
    try {
      handle = request(() => {
        timer.ran = true;
        if (disposed || pending !== timer || !timer.active) return;
        timer.active = false;
        pending = undefined;
        void run();
      }, delayMs);
    } catch {
      if (pending === timer) pending = undefined;
      timer.active = false;
      return;
    }
    if (timer.ran) return;
    if (disposed || pending !== timer || !timer.active) {
      clearHandle(handle);
      return;
    }
    timer.handle = handle;
    timer.hasHandle = true;
  };

  run = async (): Promise<void> => {
    if (disposed || attempt) return;
    let visible = false;
    try { visible = isVisible(); } catch { /* retry visibility resolution later */ }
    if (!visible) {
      schedule(options.intervalMs);
      return;
    }

    let controller: AbortController;
    try { controller = createController(); } catch {
      failures += 1;
      schedule(Math.min(
        maxBackoffMs,
        options.intervalMs * (2 ** Math.min(failures - 1, 4)),
      ));
      return;
    }
    const current: PollAttempt = { controller };
    attempt = current;
    scheduleDeadline(current);
    let failed = false;
    try { await options.task(controller.signal); } catch { failed = true; }
    if (disposed || attempt !== current) return;
    attempt = undefined;
    releaseTimer(current.deadline);
    current.deadline = undefined;
    failures = failed ? failures + 1 : 0;
    const delay = failures === 0
      ? options.intervalMs
      : Math.min(
        maxBackoffMs,
        options.intervalMs * (2 ** Math.min(failures - 1, 4)),
      );
    schedule(delay);
  };

  return {
    start() {
      if (started || disposed) return;
      started = true;
      void run();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const next = pending;
      pending = undefined;
      releaseTimer(next);
      const current = attempt;
      attempt = undefined;
      if (!current) return;
      releaseTimer(current.deadline);
      current.deadline = undefined;
      abort(current.controller);
    },
  };
}
