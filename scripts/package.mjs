import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));
const files = {};
async function collect(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name), name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) await collect(full, `${name}/`);
    else files[name] = new Uint8Array(await readFile(full));
  }
}
await collect("extension");
await mkdir("dist", { recursive: true });
const output = `dist/senseek-${manifest.version}.zip`;
await writeFile(output, zipSync(files, { level: 9 }));
console.log(`Packaged ${Object.keys(files).length} files: ${output}`);
