import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ApplicationRecoveryBoundary } from '../src/react';

const messages = {
  title: 'Application render error',
  hint: 'Use one of the available recovery actions.',
  retry: 'Retry',
  remount: 'Reload region',
  reloadApplication: 'Reload application',
};

describe('application recovery boundary', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    GlobalRegistrator.register();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    originalConsoleError = console.error;
    console.error = () => {};
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    console.error = originalConsoleError;
    GlobalRegistrator.unregister();
  });

  it('catches a render error while callers retain reporting, reveal and copy policy', () => {
    const reports: string[] = [];
    let reveals = 0;
    function Broken(): never {
      throw new Error('render failed');
    }

    act(() => root.render(
      <ApplicationRecoveryBoundary
        scope="product-shell"
        messages={messages}
        onError={(error, info, scope) => {
          reports.push(`${scope}:${error.message}:${Boolean(info.componentStack)}`);
          throw new Error('reporting failed');
        }}
        onRevealError={() => {
          reveals += 1;
          throw new Error('reveal failed');
        }}
      >
        <Broken />
      </ApplicationRecoveryBoundary>,
    ));

    expect(container.getAttribute('role')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Application render error · product-shell',
    );
    expect(container.textContent).toContain('render failed');
    expect(reports).toEqual(['product-shell:render failed:true']);
    expect(reveals).toBe(1);
  });

  it('exposes retry, remount and application-reload exits without owning product work', () => {
    let shouldThrow = true;
    let reloads = 0;
    function MaybeBroken() {
      if (shouldThrow) throw new Error('transient');
      return <span>ready</span>;
    }

    act(() => root.render(
      <ApplicationRecoveryBoundary
        messages={messages}
        reloadApplication={() => {
          reloads += 1;
          throw new Error('reload failed');
        }}
      >
        <MaybeBroken />
      </ApplicationRecoveryBoundary>,
    ));

    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Retry',
      'Reload region',
      'Reload application',
    ]);
    act(() => buttons[2]?.click());
    expect(reloads).toBe(1);

    shouldThrow = false;
    act(() => buttons[0]?.click());
    expect(container.textContent).toBe('ready');
  });
});
