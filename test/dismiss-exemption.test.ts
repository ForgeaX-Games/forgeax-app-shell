import { describe, expect, it } from 'bun:test';
import {
  OWNED_INTERACTION_SURFACE_SELECTOR,
  isDismissExemptInteractionTarget,
} from '../src/react';

function targetMatching(...matches: string[]): Element {
  const target = {
    closest: (selector: string) => matches.includes(selector) ? target : null,
  } as unknown as Element;
  return target;
}

describe('dismiss-exempt interaction target', () => {
  it('recognizes an owned portalled interaction surface', () => {
    const target = {
      closest: (selector: string) => selector === OWNED_INTERACTION_SURFACE_SELECTOR
        ? target
        : null,
    } as unknown as Element;

    expect(isDismissExemptInteractionTarget(target)).toBe(true);
  });

  it('recognizes caller-owned legacy and host selectors', () => {
    const productMenu = {
      closest: (selector: string) => selector === '.product-menu' ? productMenu : null,
    } as unknown as Element;
    const hostMenu = {
      closest: (selector: string) => selector === '.host-menu' ? hostMenu : null,
    } as unknown as Element;
    const selectors = ['.product-menu', '.host-menu'];

    expect(isDismissExemptInteractionTarget(productMenu, selectors)).toBe(true);
    expect(isDismissExemptInteractionTarget(hostMenu, selectors)).toBe(true);
  });

  it('rejects null and unrelated targets', () => {
    expect(isDismissExemptInteractionTarget(null)).toBe(false);
    expect(isDismissExemptInteractionTarget(targetMatching())).toBe(false);
  });

  it('isolates an invalid caller selector without hiding a later match', () => {
    const target = {
      closest: (selector: string) => {
        if (selector === '[') throw new DOMException('invalid selector');
        return selector === '.valid' ? target : null;
      },
    } as unknown as Element;

    expect(isDismissExemptInteractionTarget(target, ['[', '.valid'])).toBe(true);
  });
});
