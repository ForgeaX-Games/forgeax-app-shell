import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DockTabStatusSummary } from '../src/react';

describe('DockTabStatusSummary', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    GlobalRegistrator.register();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    GlobalRegistrator.unregister();
  });

  it('owns stable summary, item, icon, and value hooks in caller order', () => {
    const summaryRef = createRef<HTMLSpanElement>();
    act(() => root.render(
      <DockTabStatusSummary
        ref={summaryRef}
        className="product-summary"
        data-panel="info"
        aria-label="2 errors, 1 warning"
        items={[
          { id: 'errors', tone: 'error', icon: '✖', value: 2 },
          { id: 'warnings', tone: 'warning', icon: '⚠', value: 1 },
        ]}
      />,
    ));

    expect(summaryRef.current?.className)
      .toBe('fx-dock-tab-status-summary product-summary');
    expect(summaryRef.current?.getAttribute('data-panel')).toBe('info');
    expect(summaryRef.current?.getAttribute('aria-label')).toBe('2 errors, 1 warning');

    const items = Array.from(
      summaryRef.current!.querySelectorAll<HTMLElement>('.fx-dock-tab-status-item'),
    );
    expect(items.map((item) => item.getAttribute('data-status-id')))
      .toEqual(['errors', 'warnings']);
    expect(items.map((item) => item.className)).toEqual([
      'fx-dock-tab-status-item fx-dock-tab-status-item--error',
      'fx-dock-tab-status-item fx-dock-tab-status-item--warning',
    ]);
    expect(items.map((item) => item.querySelector('.fx-dock-tab-status-icon')?.textContent))
      .toEqual(['✖', '⚠']);
    expect(items.every((item) => item.querySelector('.fx-dock-tab-status-icon')?.getAttribute('aria-hidden') === 'true'))
      .toBe(true);
    expect(items.map((item) => item.querySelector('.fx-dock-tab-status-value')?.textContent))
      .toEqual(['2', '1']);
  });

  it('does not invent product copy or omission policy', () => {
    act(() => root.render(<DockTabStatusSummary items={[]} />));

    const summary = host.querySelector<HTMLElement>('.fx-dock-tab-status-summary')!;
    expect(summary.children).toHaveLength(0);
    expect(summary.getAttribute('aria-label')).toBeNull();
  });
});
