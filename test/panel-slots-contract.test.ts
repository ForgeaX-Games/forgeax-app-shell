import { expect, test } from 'bun:test';
import type { ComponentType } from 'react';
import type { PanelRenderers, CreateExtensionPortOptions, ExtensionToolCall } from '../src/application';
import { createExtensionPort, createWindowTransport } from '@forgeax/extension-platform/transport';

function contract(slots: PanelRenderers) {
  const picker: ComponentType<{ preferredAgentExtensionId?: string }> | undefined = slots.slots?.CornerAgentPicker;
  slots.editor?.setContextMenuRenderer?.(menu => { if (menu) menu.items[0]?.onClick?.(); });
  slots.editor?.installBridge?.({
    onEditorHealth(entry) { const code: string = entry.code; void code; },
    onEditorConsole(entry) { const text: string = entry.text; void text; },
    onEditorNetwork(entry) { const ms: number = entry.ms; void ms; },
    onEditorRef(payload) { const kind: 'entity' | 'component' | 'asset' = payload.kind; void kind; },
    onAddAssetToChat(refs) { const path: string | undefined = refs[0]?.path; void path; },
  });
  // @ts-expect-error a menu renderer is a callback, not an arbitrary value
  const invalidEditor: PanelRenderers = { editorPanelIds: [], editor: { setContextMenuRenderer: 'wrong' } };
  // @ts-expect-error shell supplies an optional agent id, not a required number
  const invalidPicker: PanelRenderers = { editorPanelIds: [], slots: { CornerAgentPicker: (_props: { preferredAgentExtensionId: number }) => null } };
  // @ts-expect-error a transport factory must return the actual transport
  const invalidTransport: PanelRenderers = { editorPanelIds: [], extensionTransport: { createWindowTransport: () => ({}) } };
  // @ts-expect-error a narrower transport factory cannot require extra product options
  const narrowFactory: PanelRenderers = { editorPanelIds: [], extensionTransport: { createExtensionPort: (options: CreateExtensionPortOptions & { productRequired: true }) => createExtensionPort(options) } };
  function actualCaller(call: ExtensionToolCall) {
    const extensionId: string | undefined = call.caller.extensionId;
    // @ts-expect-error published Platform calls do not promise a caller instance id
    const instanceId = call.caller.instanceId;
    void extensionId; void instanceId;
  }
  void picker; void invalidEditor; void invalidPicker; void invalidTransport; void narrowFactory; void actualCaller;
}
void contract;

test('application slots accept the actual Platform transport factories by identity', () => {
  const renderers: PanelRenderers = { editorPanelIds: [], extensionTransport: { createExtensionPort, createWindowTransport } };
  expect(renderers.extensionTransport?.createExtensionPort).toBe(createExtensionPort);
  expect(renderers.extensionTransport?.createWindowTransport).toBe(createWindowTransport);
});
