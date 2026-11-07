import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromeStoreManifest, firefoxManifest } from "../scripts/manifests.mjs";

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
