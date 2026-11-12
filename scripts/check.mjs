import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
let count = 0;
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await check(path);
    else if (/\.(m?js|json|css|html|svg)$/.test(entry.name)) {
      const source = await readFile(path, "utf8");
      assert.ok(!/[\t ]+$/m.test(source), `Trailing whitespace: ${path}`);
      if (/\.m?js$/.test(path)) {
        const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
      }
      if (path.endsWith(".json")) JSON.parse(source);
      count++;
    }
  }
}
for (const folder of ["extension", "scripts", "tests"]) await check(join(root, folder));
const manifest = JSON.parse(await readFile(join(root, "extension/manifest.json"), "utf8"));
const assets = [manifest.action.default_popup, ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon), ...manifest.content_scripts.flatMap(script => [...script.js, ...script.css])];
for (const asset of assets) assert.ok((await stat(join(root, "extension", asset))).isFile(), asset);
assert.deepEqual(manifest.permissions, ["storage"]);
assert.deepEqual(manifest.content_scripts[0].matches, ["https://www.zhihu.com/*"]);
console.log(`PASS: ${count} source files checked; manifest assets exist.`);
