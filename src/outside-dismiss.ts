export type OutsideDismissReason = 'pointer' | 'focus' | 'iframe-focus';

export interface OutsideDismissEventTarget {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

export interface OutsideDismissLifecycleOptions {
  readonly isOpen: () => boolean;
  readonly isPinned: () => boolean;
  readonly containsTarget: (target: Element) => boolean;
  readonly isDismissExempt: (target: Element | null) => boolean;
  readonly onContainedPointerDown?: (target: Element) => void;
  readonly dismiss: (reason: OutsideDismissReason) => void;
  readonly documentTarget?: OutsideDismissEventTarget;
  readonly windowTarget?: OutsideDismissEventTarget;
  readonly getActiveElement?: () => Element | null;
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelFrame?: (handle: number) => void;
}

type TargetDisposition = 'inactive' | 'contained' | 'exempt' | 'outside';

/**
 * Own the browser listener lifecycle for outside pointer/focus dismissal.
 * Products inject live state, containment, exemptions and the close operation;
 * App Shell only balances listeners, coalesces deferred iframe focus, and fences
 * callbacks after disposal.
 */
export function installOutsideDismissLifecycle(
  options: OutsideDismissLifecycleOptions,
): () => void {
  const documentTarget = options.documentTarget
    ?? (typeof document === 'undefined' ? undefined : document);
  const windowTarget = options.windowTarget
    ?? (typeof window === 'undefined' ? undefined : window);
  const getActiveElement = options.getActiveElement
    ?? (() => typeof document === 'undefined' ? null : document.activeElement);
  const requestFrame = options.requestFrame
    ?? (typeof requestAnimationFrame === 'undefined'
      ? undefined
      : requestAnimationFrame.bind(globalThis));
  const cancelFrame = options.cancelFrame
    ?? (typeof cancelAnimationFrame === 'undefined'
      ? undefined
      : cancelAnimationFrame.bind(globalThis));

  if (!documentTarget || !windowTarget) return () => {};

  let disposed = false;
  let dismissRequested = false;
  let rearmWhenUnpinned = false;
  let frameHandle: number | null = null;
  let frameGeneration = 0;

  const removeListener = (
    target: OutsideDismissEventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void => {
    try { target.removeEventListener(type, listener, options); } catch { /* teardown stays isolated */ }
  };

  const disposition = (target: Element | null): TargetDisposition => {
    if (disposed) return 'inactive';
    let open: boolean;
    try { open = options.isOpen(); } catch { return 'inactive'; }
    if (!open) {
      dismissRequested = false;
      rearmWhenUnpinned = false;
      return 'inactive';
    }
    let pinned: boolean;
    try {
      pinned = options.isPinned();
    } catch {
      return 'inactive';
    }
    if (dismissRequested) {
      if (!rearmWhenUnpinned || pinned) return 'inactive';
      dismissRequested = false;
      rearmWhenUnpinned = false;
    }
    if (pinned) return 'inactive';
    if (target) {
      try {
        if (options.containsTarget(target)) return 'contained';
      } catch {
        return 'inactive';
      }
    }
    try {
      if (options.isDismissExempt(target)) return 'exempt';
    } catch {
      return 'inactive';
    }
    return 'outside';
  };

  const requestDismiss = (reason: OutsideDismissReason): void => {
    if (dismissRequested || disposed) return;
    dismissRequested = true;
    rearmWhenUnpinned = false;
    try {
      options.dismiss(reason);
    } catch {
      dismissRequested = false;
      return;
    }
    if (disposed) return;
    try {
      rearmWhenUnpinned = options.isOpen() && options.isPinned();
    } catch {
      dismissRequested = false;
      rearmWhenUnpinned = false;
    }
  };

  const onPointerDown = (event: Event): void => {
    const target = event.target as Element | null;
    const result = disposition(target);
    if (result === 'contained' && target) {
      try { options.onContainedPointerDown?.(target); } catch { /* product hook stays isolated */ }
      return;
    }
    if (result === 'outside') requestDismiss('pointer');
  };

  const onFocusIn = (event: Event): void => {
    if (disposition(event.target as Element | null) === 'outside') {
      requestDismiss('focus');
    }
  };

  const onWindowBlur = (): void => {
    if (disposed || frameHandle !== null || !requestFrame) return;
    let open: boolean;
    try { open = options.isOpen(); } catch { return; }
    if (!open) {
      dismissRequested = false;
      return;
    }
    const generation = ++frameGeneration;
    let callbackRan = false;
    let handle: number;
    try {
      handle = requestFrame(() => {
        callbackRan = true;
        if (disposed || generation !== frameGeneration) return;
        frameHandle = null;
        let active: Element | null;
        try { active = getActiveElement(); } catch { return; }
        if (!active || active.tagName !== 'IFRAME') return;
        if (disposition(active) === 'outside') requestDismiss('iframe-focus');
      });
    } catch {
      return;
    }
    if (callbackRan || disposed || generation !== frameGeneration) {
      try { cancelFrame?.(handle); } catch { /* scheduler teardown stays isolated */ }
      return;
    }
    frameHandle = handle;
  };

  let pointerRegistered = false;
  let focusRegistered = false;
  let blurRegistered = false;
  try {
    documentTarget.addEventListener('pointerdown', onPointerDown, true);
    pointerRegistered = true;
    documentTarget.addEventListener('focusin', onFocusIn);
    focusRegistered = true;
    windowTarget.addEventListener('blur', onWindowBlur);
    blurRegistered = true;
  } catch {
    if (pointerRegistered) removeListener(documentTarget, 'pointerdown', onPointerDown, true);
    if (focusRegistered) removeListener(documentTarget, 'focusin', onFocusIn);
    if (blurRegistered) removeListener(windowTarget, 'blur', onWindowBlur);
    disposed = true;
  }

  return () => {
    if (disposed) return;
    disposed = true;
    frameGeneration++;
    if (frameHandle !== null) {
      try { cancelFrame?.(frameHandle); } catch { /* scheduler teardown stays isolated */ }
      frameHandle = null;
    }
    if (pointerRegistered) removeListener(documentTarget, 'pointerdown', onPointerDown, true);
    if (focusRegistered) removeListener(documentTarget, 'focusin', onFocusIn);
    if (blurRegistered) removeListener(windowTarget, 'blur', onWindowBlur);
  };
}
