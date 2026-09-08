export async function copyDockTabCss(
  source: string | URL = new URL('../src/dock-tab.css', import.meta.url),
  destination: string | URL = new URL('../dist/dock-tab.css', import.meta.url),
): Promise<void> {
  await Bun.write(destination, Bun.file(source));
}

if (import.meta.main) await copyDockTabCss();
