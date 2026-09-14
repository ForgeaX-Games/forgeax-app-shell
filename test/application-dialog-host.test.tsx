import { afterEach, beforeEach, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createApplicationDialogService } from '../src/application';
import { useApplicationDialogRequest } from '../src/react';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  GlobalRegistrator.register();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  GlobalRegistrator.unregister();
});

it('renders a pre-mount request, advances FIFO and retains requests across host absence', async () => {
  const dialogs = createApplicationDialogService();
  function Host() {
    const head = useApplicationDialogRequest(dialogs);
    return head ? <button onClick={() => dialogs.resolveConfirmAlert(head.id, true)}>{head.options.body}</button> : null;
  }
  const first = dialogs.confirm({ body: 'First' });
  const second = dialogs.alert({ body: 'Second' });
  act(() => root.render(<Host />));
  expect(container.textContent).toBe('First');
  act(() => container.querySelector('button')!.click());
  expect(await first).toBe(true);
  expect(container.textContent).toBe('Second');
  act(() => root.render(null));
  expect(dialogs.getSnapshot()).toHaveLength(1);
  act(() => root.render(<Host />));
  expect(container.textContent).toBe('Second');
  act(() => container.querySelector('button')!.click());
  expect(await second).toBeUndefined();
  expect(container.textContent).toBe('');
});
