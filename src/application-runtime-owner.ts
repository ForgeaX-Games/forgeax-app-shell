import type { ApplicationRuntime } from './application';

/** A startup failure whose attempted rollback did not finish. */
export class ApplicationStartupCleanupError extends Error {
  constructor(
    readonly startupError: unknown,
    readonly runtime: ApplicationRuntime,
    readonly cleanupError: unknown,
  ) {
    super('Application startup failed with unfinished cleanup', { cause: startupError });
    this.name = 'ApplicationStartupCleanupError';
  }
}

export type ApplicationShutdownSnapshot =
  | { readonly status: 'ready' }
  | { readonly status: 'blocked'; readonly error: unknown; readonly retryable: boolean; readonly retrying: boolean };

export interface ApplicationRuntimeLease<Runtime extends ApplicationRuntime> {
  readonly ready: Promise<Runtime>;
  /** Releases ownership even when startup has not settled yet. */
  release(): void;
}

export interface ApplicationRuntimeOwner {
  acquire<Runtime extends ApplicationRuntime>(start: () => Promise<Runtime>): ApplicationRuntimeLease<Runtime>;
  getSnapshot(): ApplicationShutdownSnapshot;
  subscribe(listener: () => void): () => void;
  /** Explicit caller action only; ordinary cleanup errors are never retried. */
  retryShutdown(): Promise<void>;
}

/** Product-scoped ownership above a replaceable React subtree. No global cache,
 * forced discard, or automatic retry: replacement waits for prior retirement. */
export function createApplicationRuntimeOwner(options: {
  isCleanupDeferred(error: unknown): boolean;
}): ApplicationRuntimeOwner {
  type Record = {
    runtime?: ApplicationRuntime;
    released: boolean;
    finish(): void;
    shutdown?: Promise<void>;
  };
  let tail = Promise.resolve();
  let blocked: Record | undefined;
  let snapshot: ApplicationShutdownSnapshot = { status: 'ready' };
  const listeners = new Set<() => void>();
  const publish = (next: ApplicationShutdownSnapshot): void => {
    snapshot = next;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* Reporting must not strand ownership. */ }
    }
  };
  const retainFailure = (record: Record, error: unknown): void => {
    blocked = record;
    let retryable = false;
    try { retryable = options.isCleanupDeferred(error); } catch { /* Fail closed. */ }
    publish({ status: 'blocked', error, retryable, retrying: false });
  };
  const shutdown = (record: Record): Promise<void> => {
    if (record.shutdown) return record.shutdown;
    const pending = Promise.resolve().then(() => record.runtime!.dispose()).then(() => {
      record.shutdown = undefined;
      record.runtime = undefined;
      if (blocked === record) {
        blocked = undefined;
        publish({ status: 'ready' });
      }
      record.finish();
    }, error => {
      record.shutdown = undefined;
      retainFailure(record, error);
      throw error;
    });
    record.shutdown = pending;
    void pending.catch(() => undefined);
    return pending;
  };
  return {
    acquire(start) {
      const previous = tail;
      let finish!: () => void;
      tail = new Promise<void>(resolve => { finish = resolve; });
      const record: Record = { released: false, finish };
      const ready = previous.then(async () => {
        if (record.released) {
          record.finish();
          throw new Error('Application runtime acquisition was released before startup');
        }
        try {
          const runtime = await start();
          record.runtime = runtime;
          if (record.released) void shutdown(record).catch(() => undefined);
          return runtime;
        } catch (error) {
          if (error instanceof ApplicationStartupCleanupError) {
            record.runtime = error.runtime;
            record.released = true;
            retainFailure(record, error.cleanupError);
            throw error.startupError;
          }
          record.finish();
          throw error;
        }
      });
      return {
        ready,
        release() {
          if (record.released) return;
          record.released = true;
          if (record.runtime) void shutdown(record).catch(() => undefined);
        },
      };
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    retryShutdown() {
      if (!blocked || snapshot.status !== 'blocked') return Promise.resolve();
      if (!snapshot.retryable) return Promise.reject(snapshot.error);
      if (blocked.shutdown) return blocked.shutdown;
      const pending = shutdown(blocked);
      publish({ ...snapshot, retrying: true });
      return pending;
    },
  };
}
