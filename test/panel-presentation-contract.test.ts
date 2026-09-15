import { expect, test } from 'bun:test';
import {
  type PanelActionContribution,
  type PanelHeaderDefinition,
} from '../src/application';
import { createPanelActionRegistry } from '../src/panel-action-registry';

const actions: readonly PanelActionContribution[] = [
  { id: 'save', panelId: 'main', command: 'save', title: 'Save', group: 'file' },
  { id: 'layout', panelId: 'main', kind: 'menu', title: 'Layout', labelContextKey: 'layout.title', itemsContextKey: 'layout.items', items: [
    { id: 'reset', command: 'reset', title: 'Reset', tone: 'reset' },
    { id: 'separator', kind: 'separator' },
  ] },
  { id: 'zoom', panelId: 'main', kind: 'control', control: 'zoom' },
];

function contract() {
  // @ts-expect-error command actions require an executable command
  const missingCommand: PanelActionContribution = { id: 'save', panelId: 'main', title: 'Save' };
  // @ts-expect-error command actions require the displayed title
  const missingTitle: PanelActionContribution = { id: 'save', panelId: 'main', command: 'save' };
  // @ts-expect-error menu actions require their item definitions
  const missingItems: PanelActionContribution = { id: 'menu', panelId: 'main', kind: 'menu', title: 'Menu' };
  // @ts-expect-error controls are rendered in headers, not context menus
  const contextControl: PanelActionContribution = { id: 'zoom', panelId: 'main', kind: 'control', control: 'zoom', location: 'context' };
  // @ts-expect-error control actions require a renderer registration id
  const missingControl: PanelActionContribution = { id: 'zoom', panelId: 'main', kind: 'control' };
  const header: PanelHeaderDefinition = { badges: [{ id: 'dirty', label: 'Modified', tone: 'warning', when: 'document.dirty' }] };
  void missingCommand; void missingTitle; void missingItems; void contextControl; void missingControl; void header;
}
void contract;

test('one panel registry retains command, menu and control definitions and cleanup', () => {
  const registry = createPanelActionRegistry();
  const remove = registry.contribute('product', actions);
  expect(registry.list('main')).toEqual(actions);
  expect(registry.list('main')[1]).toBe(actions[1]);
  remove(); expect(registry.all()).toEqual([]);
});
