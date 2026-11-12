import { readFile } from "node:fs/promises";
const { chromium } = await import(process.env.ZHU_SIEVE_PLAYWRIGHT_MODULE || "playwright");
const root = new URL("../", import.meta.url);
const browser = await chromium.launch({ headless: true, executablePath: process.env.ZHU_SIEVE_CHROMIUM_EXECUTABLE });
try {
  const page = await browser.newPage();
  const source = await readFile(new URL("extension/icons/icon.svg", root), "utf8");
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:100vw;height:100vh;display:block}</style>${source}`);
    await page.screenshot({ path: filePath(`extension/icons/icon-${size}.png`), omitBackground: true });
  }
} finally { await browser.close(); }
function filePath(path) { return new URL(path, root).pathname; }
