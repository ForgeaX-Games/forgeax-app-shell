export interface CaptureInteractionEventTarget {
  addEventListener(type: string, listener: EventListener, capture?: boolean): void;
  removeEventListener(type: string, listener: EventListener, capture?: boolean): void;
}

export interface CaptureInteractionObservationOptions {
  readonly target?: CaptureInteractionEventTarget;
  readonly onPointerDown: (event: PointerEvent) => void;
  readonly onClick: (event: MouseEvent) => void;
}

/** Observe pointerdown and click in capture order without owning interaction policy. */
export function installCaptureInteractionObservation(
  options: CaptureInteractionObservationOptions,
): () => void {
  const target = options.target ?? (typeof document === 'undefined' ? undefined : document);
  if (!target) return () => {};

  let disposed = false;
  let pointerRegistered = false;
  let clickRegistered = false;

  const onPointerDown: EventListener = (event) => {
    if (disposed) return;
    try { options.onPointerDown(event as PointerEvent); } catch { /* product interaction policy stays isolated */ }
  };
  const onClick: EventListener = (event) => {
    if (disposed) return;
    try { options.onClick(event as MouseEvent); } catch { /* product interaction policy stays isolated */ }
  };
  const remove = (type: string, listener: EventListener, registered: boolean): void => {
    if (!registered) return;
    try { target.removeEventListener(type, listener, true); } catch { /* cleanup continues */ }
  };

  try {
    // Occupy each registration before calling the host so register-then-throw
    // targets are still rolled back and retained listeners stay fenced.
    pointerRegistered = true;
    target.addEventListener('pointerdown', onPointerDown, true);
    clickRegistered = true;
    target.addEventListener('click', onClick, true);
  } catch {
    disposed = true;
    remove('click', onClick, clickRegistered);
    remove('pointerdown', onPointerDown, pointerRegistered);
  }

  return () => {
    if (disposed) return;
    disposed = true;
    remove('click', onClick, clickRegistered);
    remove('pointerdown', onPointerDown, pointerRegistered);
  };
}
