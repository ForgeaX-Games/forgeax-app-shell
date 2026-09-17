import { type HTMLAttributes, type ReactNode, useEffect, useMemo, useState } from 'react';
import type { StatusItemContribution } from './application';
import { createIntervalTaskLifecycle } from './interval-task';

export type StatusStripSlot = 'left' | 'center' | 'right';

export interface StatusStripProps extends HTMLAttributes<HTMLDivElement> {
  readonly items: Readonly<Record<string, StatusItemContribution>> | undefined;
  /** Positive integer visible-item capacities, selected by the product. */
  readonly capacity: Readonly<Record<StatusStripSlot, number>>;
  /** Mirrors the caller's CSS ordering for DOM inspection. */
  readonly visualOrder: Readonly<Record<StatusStripSlot, number>>;
  readonly intervalMs: number;
  readonly executeCommand: (id: string, args?: unknown) => unknown;
  readonly renderIcon?: (name: string) => ReactNode;
  readonly overflowDescription: (hiddenCount: number) => { readonly label: string; readonly title: string };
}

const SLOT_OF = {
  'statusbar.left': 'left',
  'statusbar.center': 'center',
  'statusbar.right': 'right',
} as const;

/** Contribution presentation only. The caller owns copy, icons, layout CSS,
 * capacities and leading content such as a relocated bottom dock tab strip. */
export function StatusStrip({
  items, capacity, visualOrder, intervalMs, executeCommand, renderIcon,
  overflowDescription, children, className, ...attributes
}: StatusStripProps): ReactNode {
  for (const slot of ['left', 'center', 'right'] as const) {
    if (!Number.isInteger(capacity[slot]) || capacity[slot] < 1) {
      throw new RangeError(`StatusStrip ${slot} capacity must be a positive integer`);
    }
  }
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const carousel = createIntervalTaskLifecycle({ intervalMs, task: () => setTick((value) => value + 1) });
    carousel.start();
    return () => carousel.dispose();
  }, [intervalMs]);

  const bySlot = useMemo(() => {
    const result: Record<StatusStripSlot, StatusItemContribution[]> = { left: [], center: [], right: [] };
    for (const item of Object.values(items ?? {})) {
      if (item.when && !item.when()) continue;
      result[SLOT_OF[item.location]].push(item);
    }
    for (const slot of Object.keys(result) as StatusStripSlot[]) {
      result[slot].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    }
    return result;
  }, [items]);

  return (
    <div className={['global-status-bar', className].filter(Boolean).join(' ')} role="status" aria-live="polite" {...attributes}>
      {children}
      {(['left', 'center', 'right'] as const).map((slot) => {
        const values = bySlot[slot];
        const cap = capacity[slot];
        const overflow = values.length > cap;
        const visible = overflow
          ? [...values.slice(0, cap - 1), values[cap - 1 + tick % (values.length - cap + 1)]!]
          : values;
        const hiddenCount = overflow ? values.length - cap : 0;
        const description = hiddenCount > 0 ? overflowDescription(hiddenCount) : undefined;
        return (
          <div key={slot} className={`sb-slot sb-slot-${slot}`} data-slot-count={values.length} data-slot-visible={visible.length} data-slot-order={visualOrder[slot]}>
            {visible.map((item) => (
              <div key={item.id} className="sb-item" data-item-id={item.id}>
                <StatusItemView item={item} executeCommand={executeCommand} renderIcon={renderIcon} />
              </div>
            ))}
            {description && <div className="sb-overflow" role="status" title={description.title} aria-label={description.label}>+{hiddenCount}↻</div>}
          </div>
        );
      })}
    </div>
  );
}

function StatusItemView({ item, executeCommand, renderIcon }: Pick<StatusStripProps, 'executeCommand' | 'renderIcon'> & { readonly item: StatusItemContribution }): ReactNode {
  const body = item.item;
  if (body.type === 'custom') return body.render();
  if (body.type === 'text') return <span className="sb-chip" title={body.tooltip}>{body.text}</span>;
  return (
    <button type="button" className="sb-chip is-button" title={body.tooltip} onClick={() => { void executeCommand(body.command, body.args); }}>
      {body.icon ? renderIcon?.(body.icon) : null}
      {body.label ? <span className="sb-chip-label">{body.label}</span> : null}
    </button>
  );
}
