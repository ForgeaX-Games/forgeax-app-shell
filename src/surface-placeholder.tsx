import type { ReactElement, ReactNode } from 'react';

export interface SurfacePlaceholderProps {
  title: ReactNode;
  /** Optional caller-owned modifier; product variants remain outside App Shell. */
  className?: string;
}

/** Product-neutral empty renderer placeholder with stable shell hooks. */
export function SurfacePlaceholder({
  title,
  className,
}: SurfacePlaceholderProps): ReactElement {
  return (
    <div className={className ? `surface-placeholder ${className}` : 'surface-placeholder'}>
      <div className="surface-placeholder-title">{title}</div>
    </div>
  );
}
