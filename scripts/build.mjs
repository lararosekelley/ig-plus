// Builds each target into dist/<target> from src/, and zips it as
// dist/ig-plus-<target>-<version>.zip. "chrome" keeps the manifest key, so
// every unpacked copy shares one extension ID; "chrome-store" is the Chrome
// Web Store upload.
//
//   node scripts/build.mjs [chrome] [chrome-store] [firefox]
//
// IG_PLUS_CHROME_CLIENT_ID sets the Chrome Web Store build's OAuth client.
import { execFileSync } from "node:child_process";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { chromeStoreManifest, firefoxManifest } from "./manifests.mjs";

const builds = {
  chrome: (manifest) => manifest,
  "chrome-store": (manifest) =>
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

const targets = process.argv.slice(2);
for (const target of targets) {
  if (!builds[target]) {
    throw new Error(
      `unknown target ${target}, expected ${Object.keys(builds).join(", ")}`,
    );
  }
}

for (const target of targets.length ? targets : Object.keys(builds)) {
  const directory = new URL(`${target}/`, dist);
  const zip = new URL(`ig-plus-${target}-${manifest.version}.zip`, dist);
  await rm(directory, { recursive: true, force: true });
  await rm(zip, { force: true });
  await cp(source, directory, { recursive: true });
  await writeFile(
    new URL("manifest.json", directory),
    `${JSON.stringify(builds[target](manifest), null, 2)}\n`,
  );
  execFileSync("zip", ["-qrX", zip.pathname, "."], { cwd: directory });
  console.log(`Built ${directory.pathname} and ${zip.pathname}`);
}
