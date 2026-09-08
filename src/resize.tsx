import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';

export interface PersistentSizeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PersistentSizeStoreOptions {
  storageKey: string;
  defaultSize: number;
  minSize: number;
  maxSize: number;
  storage?: PersistentSizeStorage | null;
}

export type PersistentSizeUpdate = number | ((previous: number) => number);

export interface PersistentSizeStore {
  getSnapshot(): number;
  subscribe(listener: () => void): () => void;
  setSize(next: PersistentSizeUpdate): void;
  reload(): void;
}

function browserPersistentSizeStorage(): PersistentSizeStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Product-neutral persistent numeric state for resizable shell regions. */
export function createPersistentSizeStore(
  options: PersistentSizeStoreOptions,
): PersistentSizeStore {
  const minSize = Math.min(options.minSize, options.maxSize);
  const maxSize = Math.max(options.minSize, options.maxSize);
  const normalize = (value: number, fallback: number): number => {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(maxSize, Math.max(minSize, Math.round(value)));
  };
  const defaultSize = normalize(options.defaultSize, minSize);
  const storage = options.storage === undefined
    ? browserPersistentSizeStorage()
    : options.storage;
  const read = (): number => {
    try {
      const raw = storage?.getItem(options.storageKey);
      if (!raw) return defaultSize;
      const parsed = Number.parseInt(raw, 10);
      return normalize(parsed, defaultSize);
    } catch {
      return defaultSize;
    }
  };

  let value = read();
  const listeners = new Set<() => void>();
  const commit = (next: number): void => {
    if (Object.is(value, next)) return;
    value = next;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* one consumer cannot block the others */ }
    }
  };

  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    },
    setSize: (next) => {
      const candidate = typeof next === 'function' ? next(value) : next;
      const normalized = normalize(candidate, value);
      if (Object.is(value, normalized)) return;
      try { storage?.setItem(options.storageKey, String(normalized)); } catch { /* optional */ }
      commit(normalized);
    },
    reload: () => commit(read()),
  };
}

export function usePersistentSizeStore(store: PersistentSizeStore): number {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useLocalSize(
  key: string,
  initial: number,
  min: number,
  max: number,
): readonly [number, (next: number | ((previous: number) => number)) => void] {
  const clamp = (value: number): number => Math.min(max, Math.max(min, value));
  const [value, setValueRaw] = useState<number>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return initial;
      const persisted = Number(raw);
      if (!Number.isFinite(persisted)) return initial;
      return clamp(persisted);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // Persistence is optional when storage is unavailable, full, or blocked.
    }
  }, [key, value]);

  const setValue = (next: number | ((previous: number) => number)): void => {
    setValueRaw((previous) => clamp(
      typeof next === 'function' ? next(previous) : next,
    ));
  };

  return [value, setValue] as const;
}

export interface ResizeHandleProps {
  orientation: 'col' | 'row';
  onDrag: (delta: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  className?: string;
  ariaLabel?: string;
  title?: string;
}

interface ElementClassLeaseRecord {
  count: number;
  readonly owned: boolean;
}

const elementClassLeases = new WeakMap<Element, Map<string, ElementClassLeaseRecord>>();

function acquireElementClassLease(
  element: Element,
  tokens: readonly string[],
): () => void {
  const uniqueTokens = [...new Set(tokens)];
  let records = elementClassLeases.get(element);
  if (!records) {
    records = new Map();
    elementClassLeases.set(element, records);
  }
  for (const token of uniqueTokens) {
    const existing = records.get(token);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const owned = !element.classList.contains(token);
    if (owned) element.classList.add(token);
    records.set(token, { count: 1, owned });
  }

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (const token of uniqueTokens) {
      const record = records?.get(token);
      if (!record) continue;
      record.count -= 1;
      if (record.count > 0) continue;
      records?.delete(token);
      if (record.owned) element.classList.remove(token);
    }
    if (records?.size === 0) elementClassLeases.delete(element);
  };
}

export type PointerDragFinishReason = 'pointerup' | 'pointercancel' | 'lostpointercapture' | 'dispose' | 'error';

export interface PointerDragSessionOptions<Session> {
  readonly element: HTMLElement;
  readonly begin: (event: globalThis.PointerEvent) => Session | null;
  readonly move: (session: Session, event: globalThis.PointerEvent) => void;
  readonly end?: (session: Session, reason: PointerDragFinishReason) => void;
  readonly preventDefault?: boolean;
  readonly stopPropagation?: boolean;
  readonly draggingClassName?: string;
}

export type ThresholdPointerDragFinishReason =
  | 'pointerup'
  | 'pointercancel'
  | 'cancel'
  | 'dispose'
  | 'error';

export interface ThresholdPointerDragSessionOptions<Session> {
  readonly target: Window;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly threshold: number;
  readonly begin: (event: globalThis.PointerEvent) => Session | null;
  readonly move: (session: Session, event: globalThis.PointerEvent) => void;
  readonly end?: (session: Session, reason: ThresholdPointerDragFinishReason) => void;
  readonly onSettled?: (reason: ThresholdPointerDragFinishReason, started: boolean) => void;
  readonly registerCancel?: (cancel: () => void) => void | (() => void);
}

export interface ThresholdPointerDragSession {
  cancel(): void;
  dispose(): void;
}

/** Own one post-pointerdown threshold arm and its global listener lifecycle. */
export function installThresholdPointerDragSession<Session>(
  options: ThresholdPointerDragSessionOptions<Session>,
): ThresholdPointerDragSession {
  const threshold = Number.isFinite(options.threshold) ? Math.max(0, options.threshold) : 0;
  let disposed = false;
  let settled = false;
  let settledReason: ThresholdPointerDragFinishReason | null = null;
  let starting = false;
  let active: Session | null = null;
  let unregisterCancel: (() => void) | null = null;

  const removeListeners = (): void => {
    options.target.removeEventListener('pointermove', onPointerMove, true);
    options.target.removeEventListener('pointerup', onPointerFinish, true);
    options.target.removeEventListener('pointercancel', onPointerFinish, true);
  };

  const releaseCancelRegistration = (): void => {
    const unregister = unregisterCancel;
    unregisterCancel = null;
    try { unregister?.(); } catch { /* injected cancellation cleanup stays isolated */ }
  };

  const settle = (reason: ThresholdPointerDragFinishReason): void => {
    if (settled) return;
    settled = true;
    settledReason = reason;
    removeListeners();
    releaseCancelRegistration();
    const current = active;
    active = null;
    if (current !== null) {
      try { options.end?.(current, reason); } catch { /* injected teardown stays isolated */ }
    }
    try { options.onSettled?.(reason, current !== null); } catch { /* observation stays isolated */ }
  };

  function onPointerMove(event: globalThis.PointerEvent): void {
    if (settled || event.pointerId !== options.pointerId) return;
    if (active === null) {
      if (starting) return;
      if (Math.hypot(event.clientX - options.startX, event.clientY - options.startY) < threshold) return;
      starting = true;
      let candidate: Session | null;
      try {
        candidate = options.begin(event);
      } catch {
        starting = false;
        settle('error');
        return;
      }
      starting = false;
      if (candidate === null) {
        settle('cancel');
        return;
      }
      if (settled) {
        try { options.end?.(candidate, settledReason ?? 'dispose'); } catch { /* stale candidate teardown stays isolated */ }
        return;
      }
      active = candidate;
    }
    const current = active;
    if (current === null) return;
    try {
      options.move(current, event);
    } catch {
      settle('error');
    }
  }

  function onPointerFinish(event: globalThis.PointerEvent): void {
    if (settled || event.pointerId !== options.pointerId) return;
    settle(event.type === 'pointercancel' ? 'pointercancel' : 'pointerup');
  }

  options.target.addEventListener('pointermove', onPointerMove, true);
  options.target.addEventListener('pointerup', onPointerFinish, true);
  options.target.addEventListener('pointercancel', onPointerFinish, true);

  if (options.registerCancel) {
    let registered: void | (() => void);
    try {
      registered = options.registerCancel(() => settle('cancel'));
    } catch {
      settle('error');
      registered = undefined;
    }
    if (registered) {
      if (settled) {
        try { registered(); } catch { /* synchronous cancellation cleanup stays isolated */ }
      } else {
        unregisterCancel = registered;
      }
    }
  }

  return {
    cancel: () => settle('cancel'),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      settle('dispose');
    },
  };
}

/** Own one imperative pointer-capture drag session and its balanced teardown. */
export function installPointerDragSession<Session>(
  options: PointerDragSessionOptions<Session>,
): () => void {
  const { element } = options;
  let disposed = false;
  let starting = false;
  let active: {
    readonly pointerId: number;
    readonly session: Session;
    readonly releaseClass: () => void;
  } | null = null;

  const removeSessionListeners = (): void => {
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerFinish);
    element.removeEventListener('pointercancel', onPointerFinish);
    element.removeEventListener('lostpointercapture', onPointerFinish);
  };

  const finish = (reason: PointerDragFinishReason): void => {
    const current = active;
    if (!current) return;
    active = null;
    removeSessionListeners();
    try { element.releasePointerCapture(current.pointerId); } catch { /* capture may already be lost */ }
    try { current.releaseClass(); } catch { /* class ownership remains fail-soft */ }
    try { options.end?.(current.session, reason); } catch { /* injected teardown stays isolated */ }
  };

  function onPointerMove(event: globalThis.PointerEvent): void {
    const current = active;
    if (!current || current.pointerId !== event.pointerId) return;
    try {
      options.move(current.session, event);
    } catch {
      finish('error');
    }
  }

  function onPointerFinish(event: globalThis.PointerEvent): void {
    if (!active || active.pointerId !== event.pointerId) return;
    const reason = event.type === 'pointercancel'
      ? 'pointercancel'
      : event.type === 'lostpointercapture'
        ? 'lostpointercapture'
        : 'pointerup';
    finish(reason);
  }

  const onPointerDown = (event: globalThis.PointerEvent): void => {
    if (disposed || active || starting) return;
    starting = true;
    let session: Session | null;
    try {
      session = options.begin(event);
    } catch {
      starting = false;
      return;
    }
    starting = false;
    if (session === null) return;
    if (disposed) {
      try { options.end?.(session, 'dispose'); } catch { /* stale candidate teardown stays isolated */ }
      return;
    }
    if (options.preventDefault) event.preventDefault();
    if (options.stopPropagation) event.stopPropagation();
    const classTokens = options.draggingClassName?.trim().split(/\s+/).filter(Boolean) ?? [];
    active = {
      pointerId: event.pointerId,
      session,
      releaseClass: acquireElementClassLease(element, classTokens),
    };
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerFinish);
    element.addEventListener('pointercancel', onPointerFinish);
    element.addEventListener('lostpointercapture', onPointerFinish);
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      finish('error');
    }
  };

  element.addEventListener('pointerdown', onPointerDown);
  return () => {
    if (disposed) return;
    disposed = true;
    element.removeEventListener('pointerdown', onPointerDown);
    finish('dispose');
  };
}

export type AnchoredResizeDirection = 'subtract' | 'add';

export interface AnchoredResizeSession {
  readonly startSize: number;
  readonly direction: AnchoredResizeDirection;
  totalDelta: number;
}

/** Capture one unclamped drag origin so overshoot stays pinned until the pointer returns. */
export function beginAnchoredResize(
  startSize: number,
  direction: AnchoredResizeDirection = 'subtract',
): AnchoredResizeSession {
  return { startSize, direction, totalDelta: 0 };
}

/** Project incremental pointer travel from the stable drag origin. */
export function applyAnchoredResizeDelta(
  session: AnchoredResizeSession,
  delta: number,
): number {
  session.totalDelta += delta;
  return session.startSize + (session.direction === 'subtract' ? -session.totalDelta : session.totalDelta);
}

export function ResizeHandle({
  orientation,
  onDrag,
  onDragStart,
  onDragEnd,
  className,
  ariaLabel,
  title,
}: ResizeHandleProps) {
  const startRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  const resetGlobalDragStyles = (): void => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  const finishDrag = (): void => {
    if (!startRef.current) return;
    startRef.current = null;
    resetGlobalDragStyles();
    try { onDragEndRef.current?.(); } catch { /* injected lifecycle stays isolated */ }
  };

  useEffect(() => finishDrag, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (startRef.current) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    startRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    document.body.style.cursor = orientation === 'col' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    try {
      onDragStart?.();
    } catch {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      finishDrag();
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!startRef.current || startRef.current.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - startRef.current.x;
    const deltaY = event.clientY - startRef.current.y;
    startRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    try {
      onDrag(orientation === 'col' ? deltaX : deltaY);
    } catch {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      finishDrag();
    }
  };

  const finish = (event: PointerEvent<HTMLDivElement>): void => {
    if (!startRef.current || startRef.current.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The browser may already have released this pointer.
    }
    finishDrag();
  };

  return (
    <div
      className={`resize-handle resize-handle-${orientation}${className ? ` ${className}` : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      title={title}
      role="separator"
      aria-orientation={orientation === 'col' ? 'vertical' : 'horizontal'}
      aria-label={ariaLabel}
    />
  );
}

export interface AnchoredResizeHandleProps extends Omit<
  ResizeHandleProps,
  'onDrag' | 'onDragStart' | 'onDragEnd'
> {
  readSize: () => number;
  writeSize: (next: number) => void;
  direction?: AnchoredResizeDirection;
  resizingBodyClassName?: string;
}

/** Product-neutral anchored resize session over the public pointer carrier. */
export function AnchoredResizeHandle({
  readSize,
  writeSize,
  direction = 'subtract',
  resizingBodyClassName,
  ...handleProps
}: AnchoredResizeHandleProps) {
  const readSizeRef = useRef(readSize);
  const writeSizeRef = useRef(writeSize);
  const directionRef = useRef(direction);
  const bodyClassNameRef = useRef(resizingBodyClassName);
  readSizeRef.current = readSize;
  writeSizeRef.current = writeSize;
  directionRef.current = direction;
  bodyClassNameRef.current = resizingBodyClassName;

  const sessionRef = useRef<{
    resize: AnchoredResizeSession;
    releaseBodyClass: () => void;
  } | null>(null);

  const finishSession = (): void => {
    const active = sessionRef.current;
    if (!active) return;
    sessionRef.current = null;
    try { active.releaseBodyClass(); } catch { /* body class ownership stays fail-soft */ }
  };

  useEffect(() => finishSession, []);

  const startSession = (): void => {
    finishSession();
    const bodyClassTokens = bodyClassNameRef.current?.trim().split(/\s+/).filter(Boolean) ?? [];
    const resize = beginAnchoredResize(readSizeRef.current(), directionRef.current);
    const releaseBodyClass = typeof document !== 'undefined' && bodyClassTokens.length > 0
      ? acquireElementClassLease(document.body, bodyClassTokens)
      : () => {};
    sessionRef.current = {
      resize,
      releaseBodyClass,
    };
  };

  const applyDelta = (delta: number): void => {
    const active = sessionRef.current;
    if (!active) return;
    writeSizeRef.current(applyAnchoredResizeDelta(active.resize, delta));
  };

  return (
    <ResizeHandle
      {...handleProps}
      onDrag={applyDelta}
      onDragStart={startSession}
      onDragEnd={finishSession}
    />
  );
}
