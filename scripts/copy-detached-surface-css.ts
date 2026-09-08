export async function copyDetachedSurfaceCss(
  source: string | URL = new URL('../src/detached.css', import.meta.url),
  destination: string | URL = new URL('../dist/detached.css', import.meta.url),
): Promise<void> {
  await Bun.write(destination, Bun.file(source));
}

if (import.meta.main) await copyDetachedSurfaceCss();
