export interface BoundedFrameRetryLifecycleOptions {
  readonly attempt: () => boolean;
  readonly onSuccess?: () => void;
  readonly maxFrames?: number;
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelFrame?: (handle: number) => void;
}

/**
 * Attempt immediately, then retry on a bounded number of animation frames.
 * Products own the work and success predicate; App Shell owns scheduling,
 * cancellation, stale-callback fencing and best-effort exception isolation.
 */
export function installBoundedFrameRetryLifecycle(
  options: BoundedFrameRetryLifecycleOptions,
): () => void {
  const requestFrame = options.requestFrame
    ?? (typeof requestAnimationFrame === 'undefined'
      ? undefined
      : requestAnimationFrame.bind(globalThis));
  const cancelFrame = options.cancelFrame
    ?? (typeof cancelAnimationFrame === 'undefined'
      ? undefined
      : cancelAnimationFrame.bind(globalThis));
  const requestedMaxFrames = options.maxFrames ?? 240;
  const maxFrames = Number.isFinite(requestedMaxFrames)
    ? Math.max(0, Math.floor(requestedMaxFrames))
    : 0;

  let disposed = false;
  let completed = false;
  let attemptedFrames = 0;
  let frameHandle: number | null = null;
  let frameGeneration = 0;

  const attempt = (): boolean => {
    if (disposed || completed) return true;
    let succeeded = false;
    try { succeeded = options.attempt() === true; } catch { /* retryable product work stays isolated */ }
    if (disposed || !succeeded) return disposed;
    completed = true;
    frameGeneration++;
    try { options.onSuccess?.(); } catch { /* notification stays isolated */ }
    return true;
  };

  const schedule = (): void => {
    if (disposed || completed || !requestFrame || attemptedFrames >= maxFrames) return;
    attemptedFrames++;
    const generation = ++frameGeneration;
    let callbackRan = false;
    let handle: number;
    try {
      handle = requestFrame(() => {
        callbackRan = true;
        if (disposed || completed || generation !== frameGeneration) return;
        frameGeneration++;
        frameHandle = null;
        if (!attempt()) schedule();
      });
    } catch {
      if (generation === frameGeneration) frameGeneration++;
      return;
    }
    if (callbackRan || disposed || completed || generation !== frameGeneration) {
      try { cancelFrame?.(handle); } catch { /* scheduler teardown stays isolated */ }
      return;
    }
    frameHandle = handle;
  };

  if (!attempt()) schedule();

  return () => {
    if (disposed) return;
    disposed = true;
    frameGeneration++;
    if (frameHandle !== null) {
      try { cancelFrame?.(frameHandle); } catch { /* scheduler teardown stays isolated */ }
      frameHandle = null;
    }
  };
}
