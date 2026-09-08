export async function copyPanelCss(
  source: string | URL = new URL('../src/panel.css', import.meta.url),
  destination: string | URL = new URL('../dist/panel.css', import.meta.url),
): Promise<void> {
  await Bun.write(destination, Bun.file(source));
}

if (import.meta.main) await copyPanelCss();
