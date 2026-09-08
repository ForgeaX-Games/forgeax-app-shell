import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

export interface DockTabFrameProps extends HTMLAttributes<HTMLDivElement> {
  /** Caller-owned leading presentation, such as a product icon. */
  leading?: ReactNode;
  /** Caller-owned trailing action; App Shell only fixes its slot position. */
  action?: ReactNode;
}

export type DockTabActionProps = HTMLAttributes<HTMLDivElement>;
export type DockTabIconProps = HTMLAttributes<HTMLSpanElement>;
export type DockTabTitleProps = HTMLAttributes<HTMLSpanElement>;

function joinClassName(owned: string, caller: string | undefined): string {
  return caller ? `${owned} ${caller}` : owned;
}

/** Product-neutral Dock tab frame with stable Dockview-compatible DOM hooks. */
export const DockTabFrame = forwardRef<HTMLDivElement, DockTabFrameProps>(
  function DockTabFrame({
    leading,
    action,
    children,
    className,
    ...props
  }, ref) {
    return (
      <div
        {...props}
        ref={ref}
        className={joinClassName('dv-default-tab', className)}
      >
        {leading}
        <span className="dv-default-tab-content">{children}</span>
        {action}
      </div>
    );
  },
);

DockTabFrame.displayName = 'DockTabFrame';

/** Product-neutral trailing-action wrapper for a Dock tab frame. */
export const DockTabAction = forwardRef<HTMLDivElement, DockTabActionProps>(
  function DockTabAction({ className, ...props }, ref) {
    return (
      <div
        {...props}
        ref={ref}
        className={joinClassName('dv-default-tab-action', className)}
      />
    );
  },
);

DockTabAction.displayName = 'DockTabAction';

/** Product-neutral leading-icon wrapper with a stable styling hook. */
export const DockTabIcon = forwardRef<HTMLSpanElement, DockTabIconProps>(
  function DockTabIcon({ className, ...props }, ref) {
    return (
      <span
        {...props}
        ref={ref}
        className={joinClassName('fx-dock-tab-icon', className)}
      />
    );
  },
);

DockTabIcon.displayName = 'DockTabIcon';

/** Product-neutral tab-title wrapper with a stable styling hook. */
export const DockTabTitle = forwardRef<HTMLSpanElement, DockTabTitleProps>(
  function DockTabTitle({ className, ...props }, ref) {
    return (
      <span
        {...props}
        ref={ref}
        className={joinClassName('fx-dock-tab-title', className)}
      />
    );
  },
);

DockTabTitle.displayName = 'DockTabTitle';
