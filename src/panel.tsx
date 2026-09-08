import type { HTMLAttributes, ReactElement, ReactNode } from 'react';

export type PanelContentPadding = 'none' | 'sm' | 'md';
export type PanelContentScroll = 'none' | 'auto';
export type PanelContentTone = 'default' | 'surface' | 'tool';

export interface PanelContentPolicy {
  readonly padding?: PanelContentPadding;
  readonly scroll?: PanelContentScroll;
  readonly tone?: PanelContentTone;
}

export interface PanelSurfaceProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'content' | 'id'> {
  readonly id: string;
  readonly registered?: boolean;
  readonly singleTab?: 'default' | 'full' | 'hideTitle';
  readonly header?: ReactNode;
  readonly content?: PanelContentPolicy;
  readonly children?: ReactNode;
}

export interface PanelEmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  readonly title: ReactNode;
  readonly detail?: ReactNode;
}

/** Product-neutral empty panel presentation with caller-owned content. */
export function PanelEmptyState({
  title,
  detail,
  className,
  ...props
}: PanelEmptyStateProps): ReactElement {
  return (
    <div
      {...props}
      className={className ? `fx-panel-empty ${className}` : 'fx-panel-empty'}
    >
      <div className="fx-panel-empty-title">{title}</div>
      {detail == null ? null : <div className="fx-panel-empty-detail">{detail}</div>}
    </div>
  );
}

/** Product-neutral panel section and content presentation. */
export function PanelSurface({
  id,
  registered = false,
  singleTab,
  header,
  content,
  children,
  className,
  ...props
}: PanelSurfaceProps): ReactElement {
  return (
    <section
      {...props}
      className={className ? `fx-panel ${className}` : 'fx-panel'}
      data-fx-panel-id={id}
      data-panel-registered={registered ? 'true' : 'false'}
      data-dock-single-tab={singleTab}
      data-fx-slot={`DockPanel:${id}`}
    >
      {header}
      <div
        className="fx-panel-content"
        data-padding={content?.padding ?? 'none'}
        data-scroll={content?.scroll ?? 'auto'}
        data-tone={content?.tone ?? 'default'}
      >
        {children}
      </div>
    </section>
  );
}
