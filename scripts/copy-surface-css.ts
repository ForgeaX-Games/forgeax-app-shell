export async function copySurfaceCss(
  source: string | URL = new URL('../src/surface.css', import.meta.url),
  destination: string | URL = new URL('../dist/surface.css', import.meta.url),
): Promise<void> {
  await Bun.write(destination, Bun.file(source));
}

if (import.meta.main) await copySurfaceCss();
