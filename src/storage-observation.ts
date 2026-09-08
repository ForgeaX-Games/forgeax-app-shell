export interface StorageEventTarget {
  addEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
  removeEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
}

export interface StorageObservationOptions {
  readonly target?: StorageEventTarget;
  readonly onStorage: (event: StorageEvent) => void;
}

/** Observe cross-document storage delivery without owning key or state policy. */
export function installStorageObservation(
  options: StorageObservationOptions,
): () => void {
  const defaultTarget = typeof window === 'undefined'
    ? undefined
    : window as unknown as StorageEventTarget;
  const target = options.target ?? defaultTarget;
  if (!target) return () => {};

  let disposed = false;
  let registered = false;
  const listener = (event: StorageEvent) => {
    if (disposed) return;
    try { options.onStorage(event); } catch { /* caller key and state policy stays isolated */ }
  };

  try {
    // Occupy the registration before calling the host so register-then-throw
    // targets are still rolled back and retained listeners stay fenced.
    registered = true;
    target.addEventListener('storage', listener);
  } catch {
    disposed = true;
    if (registered) {
      try { target.removeEventListener('storage', listener); } catch { /* rollback continues */ }
    }
  }

  return () => {
    if (disposed) return;
    disposed = true;
    if (registered) {
      try { target.removeEventListener('storage', listener); } catch { /* cleanup stays isolated */ }
    }
  };
}
