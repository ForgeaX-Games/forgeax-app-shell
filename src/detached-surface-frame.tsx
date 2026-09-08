import type { CSSProperties, ReactElement, ReactNode } from 'react';

export interface DetachedSurfaceFrameProps {
  children: ReactNode;
  /** Apply the established product-shell hooks used by detached dock panels. */
  panel?: boolean;
  /** Center caller-owned status content inside the full-window frame. */
  centered?: boolean;
}

export type DetachedSurfaceStatusTone = 'neutral' | 'error';

export interface DetachedSurfaceStatusProps {
  children: ReactNode;
  tone?: DetachedSurfaceStatusTone;
}

const fill: CSSProperties = { position: 'fixed', inset: 0 };
const centeredContent: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/** Product-neutral presentation frame for content mounted in a detached window. */
export function DetachedSurfaceFrame({
  children,
  panel = false,
  centered = false,
}: DetachedSurfaceFrameProps): ReactElement {
  return (
    <div
      className={panel
        ? 'fx-detached-surface fx-detached-panel main-area'
        : 'fx-detached-surface'}
      style={fill}
    >
      {centered ? (
        <div className="fx-detached-surface-status" style={centeredContent}>
          {children}
        </div>
      ) : children}
    </div>
  );
}

/** Product-neutral status text for a detached frame; callers retain the copy. */
export function DetachedSurfaceStatus({
  children,
  tone = 'neutral',
}: DetachedSurfaceStatusProps): ReactElement {
  return (
    <span className="fx-detached-surface-status-text" data-tone={tone}>
      {children}
    </span>
  );
}
