// The manifest in src/ is the one Chrome loads unpacked. These derive the
// manifests each store accepts from it.

// The Chrome Web Store rejects a manifest key and assigns the item ID itself,
// so Google Photos there needs an OAuth client made for that ID.
export function chromeStoreManifest(manifest, { clientId } = {}) {
  const result = structuredClone(manifest);
  delete result.key;
  if (clientId) {
    result.oauth2.client_id = clientId;
  }
  return result;
}

// Firefox runs background scripts as an event page rather than a service
// worker, and has no use for Chrome's key, OAuth client or minimum version.
// With no update_url, Firefox checks addons.mozilla.org for updates.
export function firefoxManifest(manifest) {
  const result = structuredClone(manifest);
  result.background = { scripts: [manifest.background.service_worker] };
  delete result.key;
  delete result.oauth2;
  delete result.minimum_chrome_version;
  result.developer = { name: "Lara Kelley", url: manifest.homepage_url };
  return result;
}
