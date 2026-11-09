// Prints the updates.json a signed Firefox add-on checks for its next
// version, pointing at that version's release asset.
//
//   node scripts/updates-json.mjs 1.2.0 dist/ig-plus-1.2.0.xpi
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const [version, xpi] = process.argv.slice(2);
if (!version || !xpi) {
  throw new Error("usage: updates-json.mjs VERSION XPI");
}

const manifest = JSON.parse(
  await readFile(new URL("../src/manifest.json", import.meta.url), "utf8"),
);
const hash = createHash("sha256")
  .update(await readFile(xpi))
  .digest("hex");

const updates = {
  addons: {
    [manifest.browser_specific_settings.gecko.id]: {
      updates: [
        {
          version,
          update_link: `https://github.com/lararosekelley/ig-plus/releases/download/v${version}/ig-plus-${version}.xpi`,
          update_hash: `sha256:${hash}`,
        },
      ],
    },
  },
};
console.log(JSON.stringify(updates, null, 2));
