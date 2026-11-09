import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FIREFOX_UPDATE_URL,
  chromeStoreManifest,
  firefoxManifest,
} from "../scripts/manifests.mjs";

const manifest = JSON.parse(
  await readFile(new URL("../src/manifest.json", import.meta.url), "utf8"),
);

test("the Chrome Web Store build drops the key", () => {
  const result = chromeStoreManifest(manifest);
  assert.equal(result.key, undefined);
  assert.equal(result.oauth2.client_id, manifest.oauth2.client_id);
  assert.ok(manifest.key, "the source manifest keeps its key");
});

test("the Chrome Web Store build takes the store's OAuth client", () => {
  const result = chromeStoreManifest(manifest, { clientId: "store-client" });
  assert.equal(result.oauth2.client_id, "store-client");
  assert.deepEqual(result.oauth2.scopes, manifest.oauth2.scopes);
  assert.notEqual(manifest.oauth2.client_id, "store-client");
});

test("the Firefox build runs the background as an event page", () => {
  const result = firefoxManifest(manifest);
  assert.deepEqual(result.background, {
    scripts: [manifest.background.service_worker],
  });
  for (const key of ["key", "oauth2", "minimum_chrome_version"]) {
    assert.equal(result[key], undefined, key);
  }
  assert.equal(result.developer.url, manifest.homepage_url);
  assert.equal(
    result.browser_specific_settings.gecko.id,
    manifest.browser_specific_settings.gecko.id,
  );
});

test("the Firefox build checks the releases for updates", () => {
  const result = firefoxManifest(manifest);
  assert.equal(
    result.browser_specific_settings.gecko.update_url,
    FIREFOX_UPDATE_URL,
  );
  assert.equal(manifest.browser_specific_settings.gecko.update_url, undefined);
});

test("updates.json points at the release's signed add-on", async () => {
  const xpi = join(await mkdtemp(join(tmpdir(), "ig-plus-")), "add-on.xpi");
  await writeFile(xpi, "signed");
  const updates = JSON.parse(
    execFileSync(process.execPath, [
      new URL("../scripts/updates-json.mjs", import.meta.url).pathname,
      "1.2.3",
      xpi,
    ]),
  );
  assert.deepEqual(
    updates.addons[manifest.browser_specific_settings.gecko.id].updates,
    [
      {
        version: "1.2.3",
        update_link:
          "https://github.com/lararosekelley/ig-plus/releases/download/v1.2.3/ig-plus-1.2.3.xpi",
        update_hash:
          "sha256:4a3cdfae6f291c8f544daea5b72905cf9e74c1ed427d831ad0d7ca00c73c794d",
      },
    ],
  );
});
