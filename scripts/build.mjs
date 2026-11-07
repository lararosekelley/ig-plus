// Builds dist/chrome and dist/firefox from src/, and zips each as
// dist/ig-plus-<browser>-<version>.zip.
//
//   node scripts/build.mjs [chrome] [firefox]
//
// IG_PLUS_CHROME_CLIENT_ID sets the Chrome Web Store build's OAuth client.
import { execFileSync } from "node:child_process";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { chromeStoreManifest, firefoxManifest } from "./manifests.mjs";

const builds = {
  chrome: (manifest) =>
    chromeStoreManifest(manifest, {
      clientId: process.env.IG_PLUS_CHROME_CLIENT_ID,
    }),
  firefox: firefoxManifest,
};

const source = new URL("../src/", import.meta.url);
const dist = new URL("../dist/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", source), "utf8"),
);

const browsers = process.argv.slice(2);
for (const browser of browsers) {
  if (!builds[browser]) {
    throw new Error(`unknown browser ${browser}, expected chrome or firefox`);
  }
}

for (const browser of browsers.length ? browsers : Object.keys(builds)) {
  const target = new URL(`${browser}/`, dist);
  const zip = new URL(`ig-plus-${browser}-${manifest.version}.zip`, dist);
  await rm(target, { recursive: true, force: true });
  await rm(zip, { force: true });
  await cp(source, target, { recursive: true });
  await writeFile(
    new URL("manifest.json", target),
    `${JSON.stringify(builds[browser](manifest), null, 2)}\n`,
  );
  execFileSync("zip", ["-qrX", zip.pathname, "."], { cwd: target });
  console.log(`Built ${target.pathname} and ${zip.pathname}`);
}
