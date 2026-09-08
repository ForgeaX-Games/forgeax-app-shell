import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShellSlot } from '../src/react';

describe('ShellSlot', () => {
  it('preserves the semantic element, caller props, children, and exact slot marker', () => {
    const html = renderToStaticMarkup(
      <ShellSlot
        as="section"
        name="DockPanel:chat"
        className="fx-panel"
        data-fx-panel-id="chat"
      >
        <span>Chat body</span>
      </ShellSlot>,
    );

    expect(html).toBe(
      '<section class="fx-panel" data-fx-panel-id="chat" data-fx-slot="DockPanel:chat"><span>Chat body</span></section>',
    );
  });

  it('defaults to a div without overwriting the owned marker', () => {
    expect(renderToStaticMarkup(<ShellSlot name="MainAreaBody" style={{ display: 'contents' }} />))
      .toBe('<div style="display:contents" data-fx-slot="MainAreaBody"></div>');
  });
});
