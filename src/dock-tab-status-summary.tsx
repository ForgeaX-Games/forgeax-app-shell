import {
  forwardRef,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';

export type DockTabStatusTone = 'neutral' | 'error' | 'warning';

export interface DockTabStatusSummaryItem {
  id: string;
  icon?: ReactNode;
  tone?: DockTabStatusTone;
  value: ReactNode;
}

export interface DockTabStatusSummaryProps extends HTMLAttributes<HTMLSpanElement> {
  items: readonly DockTabStatusSummaryItem[];
}

/**
 * Product-neutral status-count presentation for a Dock tab.
 *
 * The caller owns the status source, labels, visibility policy, and product
 * styling. App Shell only owns stable DOM hooks and item ordering.
 */
export const DockTabStatusSummary = forwardRef<
  HTMLSpanElement,
  DockTabStatusSummaryProps
>(function DockTabStatusSummary({ className, items, ...props }, ref): ReactElement {
  return (
    <span
      ref={ref}
      className={[
        'fx-dock-tab-status-summary',
        className,
      ].filter(Boolean).join(' ')}
      {...props}
    >
      {items.map(({ id, icon, tone = 'neutral', value }) => (
        <span
          key={id}
          className={`fx-dock-tab-status-item fx-dock-tab-status-item--${tone}`}
          data-status-id={id}
        >
          {icon !== undefined && (
            <span className="fx-dock-tab-status-icon" aria-hidden>
              {icon}
            </span>
          )}
          <span className="fx-dock-tab-status-value">{value}</span>
        </span>
      ))}
    </span>
  );
});

DockTabStatusSummary.displayName = 'DockTabStatusSummary';
