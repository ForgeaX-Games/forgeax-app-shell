export interface CoalescedFrameTaskLifecycleOptions {
  readonly task: () => void;
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelFrame?: (handle: number) => void;
}

export interface CoalescedFrameTaskLifecycle {
  schedule(): void;
  dispose(): void;
}

/**
 * Coalesce repeated requests into one next-frame task. Products own the task;
 * App Shell owns pending-state release, cancellation and stale-callback fencing.
 */
export function createCoalescedFrameTaskLifecycle(
  options: CoalescedFrameTaskLifecycleOptions,
): CoalescedFrameTaskLifecycle {
  const requestFrame = options.requestFrame
    ?? (typeof requestAnimationFrame === 'undefined'
      ? undefined
      : requestAnimationFrame.bind(globalThis));
  const cancelFrame = options.cancelFrame
    ?? (typeof cancelAnimationFrame === 'undefined'
      ? undefined
      : cancelAnimationFrame.bind(globalThis));

  let disposed = false;
  let pending = false;
  let frameHandle: number | null = null;
  let frameGeneration = 0;

  const schedule = (): void => {
    if (disposed || pending || !requestFrame) return;
    pending = true;
    const generation = ++frameGeneration;
    let callbackRan = false;
    let handle: number;
    try {
      handle = requestFrame(() => {
        callbackRan = true;
        if (disposed || !pending || generation !== frameGeneration) return;
        pending = false;
        frameHandle = null;
        frameGeneration++;
        try { options.task(); } catch { /* product work stays isolated */ }
      });
    } catch {
      if (generation === frameGeneration) {
        pending = false;
        frameHandle = null;
        frameGeneration++;
      }
      return;
    }
    if (callbackRan) return;
    if (disposed || !pending || generation !== frameGeneration) {
      try { cancelFrame?.(handle); } catch { /* scheduler teardown stays isolated */ }
      return;
    }
    frameHandle = handle;
  };

  return {
    schedule,
    dispose() {
      if (disposed) return;
      disposed = true;
      pending = false;
      frameGeneration++;
      if (frameHandle !== null) {
        try { cancelFrame?.(frameHandle); } catch { /* scheduler teardown stays isolated */ }
        frameHandle = null;
      }
    },
  };
}
