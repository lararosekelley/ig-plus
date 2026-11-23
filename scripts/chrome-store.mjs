// Uploads a Chrome Web Store build and submits it for review, as the service
// account whose access token is in ACCESS_TOKEN.
//
//   node scripts/chrome-store.mjs dist/ig-plus-chrome-store-X.Y.Z.zip
//
// PUBLISHER_ID and EXTENSION_ID name the store's publisher and item.
import { readFile } from "node:fs/promises";

const { ACCESS_TOKEN, PUBLISHER_ID, EXTENSION_ID } = process.env;
const [zip] = process.argv.slice(2);
if (!ACCESS_TOKEN || !PUBLISHER_ID || !EXTENSION_ID || !zip) {
  console.error(
    "usage: ACCESS_TOKEN=... PUBLISHER_ID=... EXTENSION_ID=... node scripts/chrome-store.mjs ZIP",
  );
  process.exit(2);
}

const ROOT = "https://chromewebstore.googleapis.com";
const item = `publishers/${PUBLISHER_ID}/items/${EXTENSION_ID}`;
const auth = { Authorization: `Bearer ${ACCESS_TOKEN}` };

async function call(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: { ...auth, ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${options.method} ${url} failed with ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

const upload = await call(`${ROOT}/upload/v2/${item}:upload`, {
  method: "POST",
  headers: {
    "X-Goog-Upload-Protocol": "raw",
    "X-Goog-Upload-File-Name": "extension.zip",
  },
  body: await readFile(zip),
});
let state = upload.uploadState;
// Large uploads are processed after the request returns.
for (let attempt = 0; state === "IN_PROGRESS" && attempt < 30; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const status = await call(`${ROOT}/v2/${item}:fetchStatus`, {
    method: "GET",
  });
  state = status.lastAsyncUploadState;
}
if (state !== "SUCCEEDED") {
  throw new Error(`Upload ended as ${state}: ${JSON.stringify(upload)}`);
}
console.log(`Uploaded version ${upload.crxVersion ?? "(unknown)"}.`);

const published = await call(`${ROOT}/v2/${item}:publish`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publishType: "DEFAULT_PUBLISH" }),
});
console.log(`Submitted for review: ${JSON.stringify(published)}`);
