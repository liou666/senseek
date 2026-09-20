import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";

const root = path.resolve("assets/senseek");
const browser = await chromium.launch({ headless: true });
try {
  await mkdir(path.join(root, "exports"), { recursive: true });
  const files = ["senseek-logo.svg", "senseek-logo-inverse.svg", "senseek-mark.svg", "senseek-mark-inverse.svg", "senseek-icon.svg", "senseek-icon-light.svg", "senseek-wordmark.svg", "senseek-logo-mono.svg", "senseek-lockup.svg"];
  const archive = {};
  async function render(source, output, width, height) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;width:${width}px;height:${height}px;background:transparent">${source.replace(/<svg /, `<svg style="display:block;width:${width}px;height:${height}px" `)}</body></html>`);
    await page.screenshot({ path: path.join(root, output), omitBackground: true });
    await page.close();
    archive[output] = new Uint8Array(await readFile(path.join(root, output)));
  }
  for (const file of files) {
    const source = await readFile(path.join(root, file), "utf8");
    archive[file] = new TextEncoder().encode(source);
    const [, w, h] = source.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const width = file.includes("mark") || file.includes("icon") ? 1024 : 2400;
    const height = Math.round(width * Number(h) / Number(w));
    await render(source, `exports/${file.replace(/\.svg$/, ".png")}`, width, height);
  }
  const icon = await readFile(path.join(root, "senseek-icon.svg"), "utf8");
  const smallIcon = await readFile(path.join(root, "source/senseek-icon-small.svg"), "utf8");
  for (const size of [16, 32, 48, 128, 256, 512]) await render(size <= 24 ? smallIcon : icon, `exports/icon-${size}.png`, size, size);
  for (const name of ["senseek-preview", "senseek-brand-sheet"]) {
    const source = await readFile(path.join(root, `previews/${name}.svg`), "utf8");
    const [, w, h] = source.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    await render(source, `previews/${name}.png`, Number(w), Number(h));
    await copyFile(path.join(root, `previews/${name}.png`), path.join(root, `previews/${name}-v2.png`));
  }
  for (const file of ["README.md", "source/OFL.txt", "source/senseek-icon-small.svg"]) archive[file] = new Uint8Array(await readFile(path.join(root, file)));
  await writeFile(path.join(root, "senseek-logo-kit.zip"), zipSync(archive, { level: 9 }));
  await copyFile(path.join(root, "senseek-logo-kit.zip"), path.join(root, "senseek-logo-kit-v2.zip"));
  console.log(`Rendered ${Object.keys(archive).length} logo-kit files. SVG wordmarks are outlined; all exports are local.`);
} finally { await browser.close(); }
