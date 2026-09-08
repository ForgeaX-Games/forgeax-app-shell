import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

export interface SurfaceRegionProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  /** Caller-owned content layered outside the fill body. */
  overlay?: ReactNode;
  /** Optional caller-owned modifier for the fill body. */
  bodyClassName?: string;
}

const joinClassNames = (base: string, modifier?: string): string => (
  modifier ? `${base} ${modifier}` : base
);

/** Product-neutral full-size surface region with an explicit fill body. */
export const SurfaceRegion = forwardRef<HTMLDivElement, SurfaceRegionProps>(
  function SurfaceRegion({
    children,
    overlay,
    className,
    bodyClassName,
    ...props
  }, ref) {
    return (
      <div
        {...props}
        ref={ref}
        className={joinClassNames('fx-surface-region', className)}
      >
        {overlay == null ? null : (
          <div className="fx-surface-region-overlay">{overlay}</div>
        )}
        <div className={joinClassNames('fx-surface-region-body', bodyClassName)}>
          {children}
        </div>
      </div>
    );
  },
);
