import type { ReactNode } from 'react';
import type { DetachedWindowCapability } from './window';
import { shouldShowDetachedPlaceholder } from './window';

export interface DetachedPanelBoundaryProps {
  readonly capability?: DetachedWindowCapability;
  readonly floatingSurfaces: Readonly<Record<string, true>>;
  readonly placeholder: ReactNode;
  readonly children: ReactNode;
}

/** Product-neutral presentation switch for a keep-anchor detached surface. */
export function DetachedPanelBoundary({
  capability,
  floatingSurfaces,
  placeholder,
  children,
}: DetachedPanelBoundaryProps): ReactNode {
  if (!capability) return children;
  try {
    const target = capability.createTarget();
    if (
      target.dockBehavior === 'keep-anchor'
      && shouldShowDetachedPlaceholder(floatingSurfaces, target.surface)
    ) {
      return placeholder;
    }
  } catch {
    // Invalid product declarations must never suppress the ordinary body.
  }
  return children;
}
