/** Stable opt-in hook for portalled controls that belong to an interaction. */
export const OWNED_INTERACTION_SURFACE_SELECTOR = '[data-fx-interaction-scope]';

/**
 * Report whether a pointer/focus target belongs to an owned or caller-exempt
 * interaction surface. Each caller selector is isolated so one malformed host
 * selector cannot suppress a later valid match or escape the dismissal guard.
 */
export function isDismissExemptInteractionTarget(
  target: Element | null,
  additionalSelectors: readonly string[] = [],
): boolean {
  if (!target) return false;

  for (const selector of [OWNED_INTERACTION_SURFACE_SELECTOR, ...additionalSelectors]) {
    try {
      if (target.closest(selector) !== null) return true;
    } catch {
      // A host may provide a malformed selector. Treat only that selector as
      // non-matching and preserve the remaining exemption contract.
    }
  }

  return false;
}
