export interface DragPresenceEventTarget {
  addEventListener(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListener, options?: boolean | EventListenerOptions): void;
}

export interface DragPresenceLifecycleOptions {
  readonly target?: DragPresenceEventTarget;
  readonly isStartTarget: (target: EventTarget | null) => boolean;
  readonly onActiveChange: (active: boolean) => void;
  /** Observes every dragover, including drags that were not admitted as active. */
  readonly onDragOver?: (target: EventTarget | null) => void;
}

/** Own one HTML5 drag-presence lease without owning target or presentation policy. */
export function installDragPresenceLifecycle(options: DragPresenceLifecycleOptions): () => void {
  const target = options.target ?? (typeof window === 'undefined' ? undefined : window);
  if (!target) return () => {};

  let disposed = false;
  let active = false;
  let startRegistered = false;
  let overRegistered = false;
  let endRegistered = false;
  let dropRegistered = false;

  const publish = (next: boolean): void => {
    if (active === next) return;
    active = next;
    try { options.onActiveChange(next); } catch { /* product presentation stays isolated */ }
  };

  const onStart: EventListener = (event) => {
    if (disposed || active) return;
    let accepted = false;
    try { accepted = options.isStartTarget(event.target); } catch { return; }
    if (disposed || !accepted) return;
    publish(true);
  };
  const onEnd: EventListener = () => {
    if (disposed) return;
    publish(false);
  };
  const onOver: EventListener = (event) => {
    if (disposed) return;
    try { options.onDragOver?.(event.target); } catch { /* product observation stays isolated */ }
  };

  const remove = (type: string, listener: EventListener, registered: boolean): void => {
    if (!registered) return;
    try { target.removeEventListener(type, listener, true); } catch { /* cleanup continues */ }
  };

  try {
    startRegistered = true;
    target.addEventListener('dragstart', onStart, true);
    overRegistered = true;
    target.addEventListener('dragover', onOver, true);
    endRegistered = true;
    target.addEventListener('dragend', onEnd, true);
    dropRegistered = true;
    target.addEventListener('drop', onEnd, true);
  } catch {
    disposed = true;
    remove('drop', onEnd, dropRegistered);
    remove('dragend', onEnd, endRegistered);
    remove('dragover', onOver, overRegistered);
    remove('dragstart', onStart, startRegistered);
    publish(false);
  }

  return () => {
    if (disposed) return;
    disposed = true;
    remove('drop', onEnd, dropRegistered);
    remove('dragend', onEnd, endRegistered);
    remove('dragover', onOver, overRegistered);
    remove('dragstart', onStart, startRegistered);
    publish(false);
  };
}
