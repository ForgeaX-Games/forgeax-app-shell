import { expect, test } from 'bun:test';
import { createCapabilityRegistry } from '@forgeax/extension-platform/platform';
import {
  createApplicationExtensionLoader,
  createApplicationMenuRegistry,
  type AppExtensionContributes,
  type ApplicationExtensionControl,
  type ApplicationExtensionLoader,
  type PageTypeRegistration,
  type PanelRenderers,
  type PanelActionContribution,
  type PanelControlContribution,
} from '../src/application';

type CommandAction = PanelActionContribution & { kind: 'command'; command: string };
type ProductControl = PanelControlContribution & { product: 'studio' };
interface Contributions extends AppExtensionContributes {
  readonly panels?: Partial<PanelRenderers> & { product: 'studio' };
  readonly pages?: readonly (PageTypeRegistration & { product: 'studio' })[];
  readonly panelActions?: readonly CommandAction[];
  readonly panelControls?: readonly ProductControl[];
}

// These functions are checked by tsc but never executed. Both directions matter:
// the concrete control rejects wide writes and cannot masquerade as a wide sink.
function checkTypes(control: ApplicationExtensionControl<unknown, Contributions>, loader: ApplicationExtensionLoader<unknown, Contributions>) {
  control.contributePanelActions('owner', [{ id: 'save', panelId: 'main', title: 'Save', kind: 'command', command: 'save' }]);
  // @ts-expect-error the concrete action channel requires its command
  control.contributePanelActions('owner', [{ id: 'save', panelId: 'main', title: 'Save', kind: 'command' }]);
  // @ts-expect-error the concrete control channel retains the product field
  control.contributePanelControls('owner', [{ id: 'toolbar', render: () => null }]);
  type Wide = ApplicationExtensionControl<unknown, AppExtensionContributes>;
  // @ts-expect-error a command-only sink cannot accept every public action
  const wideActions: Pick<Wide, 'contributePanelActions'> = control;
  // @ts-expect-error a product-only sink cannot accept every public control
  const wideControls: Pick<Wide, 'contributePanelControls'> = control;
  // @ts-expect-error the concrete panel channel requires product data
  control.contributePanels('owner', {});
  // @ts-expect-error a concrete panel sink cannot accept arbitrary shared panels
  const widePanels: Pick<Wide, 'contributePanels'> = control;
  // @ts-expect-error a concrete page sink cannot accept arbitrary shared pages
  const widePages: Pick<Wide, 'contributePagePlatform'> = control;
  // @ts-expect-error a concrete loader cannot accept arbitrary shared manifests
  const wideLoader: ApplicationExtensionLoader<unknown, AppExtensionContributes> = loader;
  void wideActions; void wideControls; void widePanels; void widePages; void wideLoader;
}
void checkTypes;

test('loader forwards concrete action and control contributions without changing lifetime', async () => {
  const trace: string[] = [];
  const control: ApplicationExtensionControl<unknown, Contributions> = {
    capabilities: createCapabilityRegistry(),
    beginSetup: manifest => { trace.push(`begin:${manifest.id}`); },
    endSetup: () => { trace.push('end'); },
    contributePanels: () => () => {},
    contributePanelActions: (_owner, actions) => {
      const command: string = actions[0]!.command;
      trace.push(command);
      return () => { trace.push('remove-action'); };
    },
    contributePanelControls: (_owner, controls) => {
      const product: 'studio' = controls[0]!.product;
      trace.push(product);
      return () => { trace.push('remove-control'); };
    },
    contributePagePlatform: () => () => {},
  };
  const loader = createApplicationExtensionLoader<unknown, Contributions>({
    menus: createApplicationMenuRegistry(), control, contextFactory: () => ({}),
    log: { error: message => { throw new Error(message); } },
  });
  await loader.load([{ id: 'product', version: '1', contributes: {
    panelActions: [{ id: 'save', panelId: 'main', title: 'Save', kind: 'command', command: 'save' }],
    panelControls: [{ id: 'toolbar', product: 'studio', render: () => null }],
  } }]);
  await loader.flush();
  expect(trace).toEqual(['begin:product', 'save', 'studio', 'end']);
  await loader.unload();
  expect(trace.slice(-2)).toEqual(['remove-control', 'remove-action']);
});

type CustomLayout = { customGrid: string };
type CustomContributes = Omit<AppExtensionContributes, 'pages'> & {
  readonly pages?: readonly import('../src/pages').PageTypeRegistration<CustomLayout>[];
};

test('generic extension loader retains custom non-Dockview page layout writes', async () => {
  const writes: unknown[] = [];
  let removed = 0;
  const page: import('../src/pages').PageTypeRegistration<CustomLayout> = {
    id: 'product:page:custom' as import('../src/pages').QualifiedPageTypeId,
    title: 'Custom', cardinality: 'singleton', panels: [], layout: { customGrid: 'columns' },
  };
  const manifest: import('../src/application').ApplicationExtensionManifest<unknown, CustomContributes> = {
    id: 'custom-product', version: '1', contributes: { pages: [page] },
  };
  const control: ApplicationExtensionControl<unknown, CustomContributes> = {
    capabilities: createCapabilityRegistry(), beginSetup: () => {}, endSetup: () => {},
    contributePanels: () => () => {}, contributePanelActions: () => () => {},
    contributePanelControls: () => () => {},
    contributePagePlatform: (_owner, contribution) => {
      writes.push(contribution.pageTypes?.[0]);
      return () => { removed++; };
    },
  };
  const loader: ApplicationExtensionLoader<unknown, CustomContributes> = createApplicationExtensionLoader<unknown, CustomContributes>({
    menus: createApplicationMenuRegistry(), control, contextFactory: () => ({}), log: { error: () => {} },
  });
  await loader.load([manifest]); await loader.flush();
  expect(writes).toEqual([page]); expect(writes[0]).toBe(page);
  await loader.unload(); expect(removed).toBe(1);
});
