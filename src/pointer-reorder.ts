export type PointerReorderFinishReason =
  | 'pointerup'
  | 'pointercancel'
  | 'buttons-released'
  | 'replacement'
  | 'cancel'
  | 'dispose'
  | 'error';

export interface PointerReorderSessionOptions<Item> {
  readonly element: HTMLElement;
  readonly target: Window;
  readonly resolveItem: (target: EventTarget | null) => Item | null;
  readonly canStart?: (event: globalThis.PointerEvent, item: Item) => boolean;
  readonly reorder: (dragged: Item, over: Item, event: globalThis.PointerEvent) => void;
  readonly onDraggingChange?: (item: Item | null, reason?: PointerReorderFinishReason) => void;
  readonly equals?: (left: Item, right: Item) => boolean;
}

export interface PointerReorderSession {
  cancel(): void;
  dispose(): void;
}

interface ActivePointerReorder<Item> {
  readonly generation: number;
  readonly pointerId: number;
  readonly item: Item;
  dragging: boolean;
  lastOver: Item | null;
}

/** Own one delegated pointer reorder lifecycle without owning item identity or mutation policy. */
export function installPointerReorderSession<Item>(
  options: PointerReorderSessionOptions<Item>,
): PointerReorderSession {
  const equals = options.equals ?? Object.is;
  let disposed = false;
  let generation = 0;
  let active: ActivePointerReorder<Item> | null = null;

  const publishDragging = (item: Item | null, reason?: PointerReorderFinishReason): void => {
    try { options.onDraggingChange?.(item, reason); } catch { /* product observation stays isolated */ }
  };

  const settle = (reason: PointerReorderFinishReason): void => {
    const current = active;
    if (current === null) return;
    active = null;
    if (current.dragging) publishDragging(null, reason);
  };

  const onPointerDown = (event: globalThis.PointerEvent): void => {
    if (disposed || event.button !== 0 || event.isPrimary === false) return;
    let item: Item | null;
    try {
      item = options.resolveItem(event.target);
      if (item === null || options.canStart?.(event, item) === false) return;
    } catch {
      return;
    }

    const nextGeneration = ++generation;
    settle('replacement');
    if (disposed || generation !== nextGeneration) return;
    active = {
      generation: nextGeneration,
      pointerId: event.pointerId,
      item,
      dragging: false,
      lastOver: null,
    };
  };

  const onPointerMove = (event: globalThis.PointerEvent): void => {
    const current = active;
    if (disposed || current === null || event.pointerId !== current.pointerId) return;
    if ((event.buttons & 1) !== 1) {
      settle('buttons-released');
      return;
    }

    let over: Item | null;
    try {
      over = options.resolveItem(event.target);
    } catch {
      settle('error');
      return;
    }
    if (active !== current || current.generation !== generation) return;
    if (over === null) return;
    let sameItem: boolean;
    try {
      sameItem = equals(over, current.item);
    } catch {
      if (active === current) settle('error');
      return;
    }
    if (active !== current || current.generation !== generation || sameItem) return;
    if (current.lastOver !== null) {
      let sameTarget: boolean;
      try {
        sameTarget = equals(over, current.lastOver);
      } catch {
        if (active === current) settle('error');
        return;
      }
      if (active !== current || current.generation !== generation || sameTarget) return;
    }
    current.lastOver = over;

    if (!current.dragging) {
      current.dragging = true;
      publishDragging(current.item);
      if (active !== current || current.generation !== generation) return;
    }

    try {
      options.reorder(current.item, over, event);
    } catch {
      settle('error');
    }
  };

  const onPointerFinish = (event: globalThis.PointerEvent): void => {
    const current = active;
    if (disposed || current === null || event.pointerId !== current.pointerId) return;
    settle(event.type === 'pointercancel' ? 'pointercancel' : 'pointerup');
  };

  options.element.addEventListener('pointerdown', onPointerDown);
  options.element.addEventListener('pointermove', onPointerMove);
  options.target.addEventListener('pointerup', onPointerFinish, true);
  options.target.addEventListener('pointercancel', onPointerFinish, true);

  return {
    cancel: () => settle('cancel'),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      generation += 1;
      options.element.removeEventListener('pointerdown', onPointerDown);
      options.element.removeEventListener('pointermove', onPointerMove);
      options.target.removeEventListener('pointerup', onPointerFinish, true);
      options.target.removeEventListener('pointercancel', onPointerFinish, true);
      settle('dispose');
    },
  };
}
