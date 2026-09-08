export async function copyResizeCss(
  source: string | URL = new URL('../src/resize.css', import.meta.url),
  destination: string | URL = new URL('../dist/resize.css', import.meta.url),
): Promise<void> {
  await Bun.write(destination, Bun.file(source));
}

if (import.meta.main) await copyResizeCss();
