import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type PointerEventHandler,
  type RefCallback,
} from 'react';

export interface TabCloseInteractionsOptions<TabElement extends HTMLElement = HTMLElement> {
  readonly close: () => void;
  readonly disabled?: boolean;
  readonly onPointerDown?: PointerEventHandler<TabElement>;
  readonly onPointerUp?: PointerEventHandler<TabElement>;
  readonly onPointerLeave?: PointerEventHandler<TabElement>;
}

export interface TabCloseInteractions<TabElement extends HTMLElement = HTMLElement> {
  readonly closeRef: RefCallback<HTMLElement>;
  readonly onPointerDown: PointerEventHandler<TabElement>;
  readonly onPointerUp: PointerEventHandler<TabElement>;
  readonly onPointerLeave: PointerEventHandler<TabElement>;
}

/**
 * Owns the browser-specific close gestures for a tab without owning tab identity,
 * close policy, or presentation. Native pointerdown keeps an action surface from
 * activating its parent tab; a middle-button close settles only the matching
 * pointer that armed it.
 */
export function useTabCloseInteractions<TabElement extends HTMLElement = HTMLElement>(
  options: TabCloseInteractionsOptions<TabElement>,
): TabCloseInteractions<TabElement> {
  const optionsRef = useRef(options);
  const closeElementRef = useRef<HTMLElement | null>(null);
  const middlePointerRef = useRef<number | null>(null);
  optionsRef.current = options;

  const closeCurrent = useCallback((): void => {
    const current = optionsRef.current;
    if (current.disabled) return;
    try {
      current.close();
    } catch {
      // The tab owner may already have disposed its backing panel.
    }
  }, []);

  const onClosePointerDown = useCallback((event: globalThis.PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    closeCurrent();
  }, [closeCurrent]);

  const closeRef = useCallback<RefCallback<HTMLElement>>((element) => {
    const previous = closeElementRef.current;
    if (previous === element) return;
    previous?.removeEventListener('pointerdown', onClosePointerDown);
    closeElementRef.current = element;
    element?.addEventListener('pointerdown', onClosePointerDown);
  }, [onClosePointerDown]);

  const forward = useCallback((
    callback: PointerEventHandler<TabElement> | undefined,
    event: ReactPointerEvent<TabElement>,
  ): void => {
    try {
      callback?.(event);
    } catch {
      // Forwarded host handlers must not corrupt the local close session.
    }
  }, []);

  const onPointerDown = useCallback<PointerEventHandler<TabElement>>((event) => {
    middlePointerRef.current = event.button === 1 ? event.pointerId : null;
    forward(optionsRef.current.onPointerDown, event);
  }, [forward]);

  const onPointerUp = useCallback<PointerEventHandler<TabElement>>((event) => {
    const matches = middlePointerRef.current === event.pointerId;
    const shouldClose = event.button === 1 && matches;
    if (matches) middlePointerRef.current = null;
    if (shouldClose) closeCurrent();
    forward(optionsRef.current.onPointerUp, event);
  }, [closeCurrent, forward]);

  const onPointerLeave = useCallback<PointerEventHandler<TabElement>>((event) => {
    if (middlePointerRef.current === event.pointerId) middlePointerRef.current = null;
    forward(optionsRef.current.onPointerLeave, event);
  }, [forward]);

  useEffect(() => () => {
    middlePointerRef.current = null;
    const closeElement = closeElementRef.current;
    closeElementRef.current = null;
    closeElement?.removeEventListener('pointerdown', onClosePointerDown);
  }, [onClosePointerDown]);

  return { closeRef, onPointerDown, onPointerUp, onPointerLeave };
}
