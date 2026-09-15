import { expect, test } from 'bun:test';
import type { PanelDescriptor, PanelRenderers, SerializedDockview, PageTypeRegistration } from '../src/application';
import type { DockRegion } from '../src/dock';

function contract(panel: PanelDescriptor) {
  // The runtime always invokes a registered body's renderer.
  const render: () => import('react').ReactNode = panel.render;
  const region: DockRegion | undefined = panel.defaultRegion;
  // @ts-expect-error registered dock panels need a body renderer
  const missingRender: PanelDescriptor = { title: 'Inspector' };
  // @ts-expect-error region names must be understood by the existing dock shell
  const invalidRegion: PanelDescriptor = { title: 'Inspector', render: () => null, defaultRegion: 'unknown-region' };
  // @ts-expect-error drawer bodies require their own renderer and title
  const invalidDrawer: PanelRenderers = { editorPanelIds: [], drawerPanels: { files: { id: 'files' } } };
  // @ts-expect-error serialized layout roots must use the actual Dockview grid shape
  const invalidLayout: SerializedDockview = { grid: { height: 600, width: 800, orientation: 'HORIZONTAL', root: 'invalid' }, panels: {} };
  function pageLayout(page: PageTypeRegistration) {
    const concrete: import('../src/pages').PageTypeRegistration<SerializedDockview> = page;
    void concrete;
  }
  void pageLayout;
  void render; void region; void missingRender; void invalidRegion; void invalidDrawer; void invalidLayout;
}
void contract;

test('panel and drawer contributions retain their existing renderers', () => {
  const render = () => 'body';
  const contributions: PanelRenderers = {
    editorPanelIds: [],
    panels: { inspector: { title: 'Inspector', defaultRegion: 'AuxBar', render } },
    drawerPanels: { files: { id: 'files', title: 'Files', location: 'drawer.bottom', render } },
  };
  expect(contributions.panels?.inspector?.render).toBe(render);
  expect(contributions.drawerPanels?.files?.render).toBe(render);
});
