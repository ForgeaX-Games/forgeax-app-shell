import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { installKeydownObservation } from './keydown-observation';

export interface FloatingMenuAnchor {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface FloatingMenuPoint {
  readonly x: number;
  readonly y: number;
}

export interface FloatingMenuProps {
  open: boolean;
  onClose(): void;
  point?: FloatingMenuPoint;
  anchor?: FloatingMenuAnchor | null;
  align?: 'start' | 'end';
  /** Gap in pixels between the anchor and menu. */
  offset?: number;
  className?: string;
  children: ReactNode;
}

const VIEWPORT_PADDING = 8;

/** Product-neutral floating menu portal with outside-dismiss and viewport clamping. */
export function FloatingMenu({
  open,
  onClose,
  point,
  anchor,
  align = 'start',
  offset = 6,
  className,
  children,
}: FloatingMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left?: number; top: number; right?: number }>({ top: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuWidth = menuRef.current?.offsetWidth ?? 0;
    const menuHeight = menuRef.current?.offsetHeight ?? 0;

    if (point) {
      const left = Math.min(point.x, viewportWidth - menuWidth - VIEWPORT_PADDING);
      const top = Math.min(point.y, viewportHeight - menuHeight - VIEWPORT_PADDING);
      setPosition({
        left: Math.max(VIEWPORT_PADDING, left),
        top: Math.max(VIEWPORT_PADDING, top),
      });
      return;
    }

    if (anchor) {
      const top = Math.min(anchor.bottom + offset, viewportHeight - menuHeight - VIEWPORT_PADDING);
      if (align === 'end') {
        const right = Math.min(
          viewportWidth - anchor.right,
          viewportWidth - menuWidth - VIEWPORT_PADDING,
        );
        setPosition({
          right: Math.max(VIEWPORT_PADDING, right),
          top: Math.max(VIEWPORT_PADDING, top),
        });
      } else {
        const left = Math.min(anchor.left, viewportWidth - menuWidth - VIEWPORT_PADDING);
        setPosition({
          left: Math.max(VIEWPORT_PADDING, left),
          top: Math.max(VIEWPORT_PADDING, top),
        });
      }
    }
  }, [align, anchor?.bottom, anchor?.left, anchor?.right, anchor?.top, offset, open, point?.x, point?.y]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    return installKeydownObservation({
      target: document,
      onKeyDown: closeOnEscape,
    });
  }, [onClose, open]);

  if (!open) return null;

  return createPortal(
    <>
      <div
        data-app-shell-floating-menu-backdrop=""
        style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-menu-backdrop)' }}
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        data-app-shell-floating-menu=""
        className={className}
        style={{
          position: 'fixed',
          left: position.left,
          right: position.right,
          top: position.top,
          zIndex: 'var(--z-menu)',
        }}
        onContextMenu={(event) => event.preventDefault()}
        role="menu"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
