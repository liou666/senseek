import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";

const source = new URL("../assets/senseek/", import.meta.url);
const extension = new URL("../extension/", import.meta.url);
const destination = new URL("icons/", extension);
await mkdir(destination, { recursive: true });
await copyFile(new URL("senseek-icon.svg", source), new URL("mark.svg", destination));

// Chrome uses manifest icons for extension-page favicons. A content hash gives
// updated artwork a new cache key, even when the extension version is unchanged.
const icons = {};
for (const size of [16, 32, 48, 128]) {
  const image = await readFile(new URL(`exports/icon-${size}.png`, source));
  const hash = createHash("sha256").update(image).digest("hex").slice(0, 12);
  icons[size] = `icons/icon-${size}-${hash}.png`;
  await writeFile(new URL(icons[size], extension), image);
}

const manifestPath = new URL("manifest.json", extension);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.icons = icons;
manifest.action.default_icon = { "16": icons[16], "32": icons[32] };
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// Keep only the current generated PNGs in the extension package.
const current = new Set(Object.values(icons).map((name) => name.slice("icons/".length)));
for (const name of await readdir(destination)) {
  if (/^icon-(16|32|48|128)(?:-[a-f0-9]{12})?\.png$/.test(name) && !current.has(name)) {
    await unlink(new URL(name, destination));
  }
}
