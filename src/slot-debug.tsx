import { useEffect, useState, type ReactElement } from 'react';
import {
  createCoalescedFrameTaskLifecycle,
} from './coalesced-frame-task';
import {
  installMutationObservation,
} from './mutation-observation';
import {
  installViewportScrollObservation,
} from './viewport-scroll';
import {
  installElementResizeObservation,
} from './element-resize-observation';
import {
  installViewportResizeObservation,
} from './viewport-resize';

interface SlotBox {
  name: string;
  parentName: string | null;
  depth: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

const OVERLAY_Z = 2147483000;
const LABEL_CORNERS = [
  { top: 2, left: 2 },
  { top: 2, right: 2 },
  { bottom: 2, left: 2 },
  { bottom: 2, right: 2 },
] as const;

/** Stable FNV-1a color bucket for a shell slot name. */
export function hashSlotHue(name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 360;
}

/** Whether a composable `debug` query contains the exact `slots` token. */
export function isSlotDebugEnabled(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): boolean {
  try {
    const debug = new URLSearchParams(search).get('debug');
    return debug?.split(',').some((flag) => flag.trim() === 'slots') ?? false;
  } catch {
    return false;
  }
}

function measureSlots(): SlotBox[] {
  const elements = Array.from(document.querySelectorAll<Element>('[data-fx-slot]'));
  const boxes: SlotBox[] = [];

  for (const element of elements) {
    const name = element.getAttribute('data-fx-slot') ?? '';
    if (!name) continue;

    let rect: DOMRect;
    if (element.firstChild) {
      const range = document.createRange();
      range.selectNodeContents(element);
      rect = range.getBoundingClientRect();
    } else {
      rect = element.getBoundingClientRect();
    }
    if (rect.width === 0 && rect.height === 0) continue;

    let depth = 0;
    let parentName: string | null = null;
    let cursor: Element | null = element.parentElement;
    while (cursor) {
      if (cursor.hasAttribute('data-fx-slot')) {
        parentName ??= cursor.getAttribute('data-fx-slot');
        depth += 1;
      }
      cursor = cursor.parentElement;
    }

    boxes.push({
      name,
      parentName,
      depth,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }

  return boxes;
}

/** Dev-time visualization derived only from live `data-fx-slot` markers. */
export function SlotDebugOverlay(): ReactElement {
  const [boxes, setBoxes] = useState<SlotBox[]>([]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const layoutFrameTask = createCoalescedFrameTaskLifecycle({
      task: () => setBoxes(measureSlots()),
    });
    const schedule = layoutFrameTask.schedule;
    setBoxes(measureSlots());

    const disposeElementResizeObservation = installElementResizeObservation({
      getElements: () => document.querySelectorAll<Element>('[data-fx-slot]'),
      onResize: schedule,
      subscribeElements: (onElementsChanged) => installMutationObservation({
        target: document.body,
        observerOptions: {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['data-fx-slot'],
        },
        onMutation: (records) => {
          let markerSetChanged = false;
          for (const record of records) {
            if (record.type === 'attributes' && record.attributeName === 'data-fx-slot') {
              markerSetChanged = true;
              break;
            }
            if (record.type !== 'childList') continue;
            const nodes = [...record.addedNodes, ...record.removedNodes];
            markerSetChanged = nodes.some((node) => node instanceof Element
              && (node.matches('[data-fx-slot]') || node.querySelector('[data-fx-slot]')));
            if (markerSetChanged) break;
          }
          if (markerSetChanged) onElementsChanged();
          schedule();
        },
      }),
    });

    const disposeViewportResizeObservation = installViewportResizeObservation({
      target: window,
      onResize: schedule,
    });
    const disposeViewportScrollObservation = installViewportScrollObservation({
      target: window,
      onScroll: schedule,
    });
    return () => {
      layoutFrameTask.dispose();
      disposeElementResizeObservation();
      disposeViewportResizeObservation();
      disposeViewportScrollObservation();
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: OVERLAY_Z,
      }}
      data-fx-slot-overlay=""
    >
      {boxes.map((box, index) => {
        const hue = hashSlotHue(box.name);
        const corner = LABEL_CORNERS[box.depth % LABEL_CORNERS.length];
        const label = box.parentName ? `${box.parentName} → ${box.name}` : box.name;
        return (
          <div
            key={`${box.name}:${index}`}
            style={{
              position: 'fixed',
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              background: `hsla(${hue}, 65%, 55%, ${Math.min(0.35, 0.10 + box.depth * 0.06)})`,
              outline: `${Math.max(1, 3 - box.depth)}px solid hsla(${hue}, 65%, 55%, 0.7)`,
              pointerEvents: 'none',
            }}
          >
            <span
              style={{
                position: 'absolute',
                ...corner,
                background: `hsla(${hue}, 65%, 25%, 0.9)`,
                color: '#fff',
                font: '10px/14px ui-monospace, monospace',
                padding: '1px 4px',
                borderRadius: 2,
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
