import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../src/audience.js", import.meta.url),
  "utf8",
);

const SHARE_URL = "/api/v1/media/configure_to_story/";
const SHARE_BODY =
  "caption=&configure_mode=1&share_to_facebook=true" +
  "&share_to_fb_destination_id=abc&share_to_fb_destination_type=USER" +
  "&upload_id=123&fb_dtsg=token";
// The next story's share, which must not inherit the last one's amendment.
const NEXT_BODY = SHARE_BODY.replace("upload_id=123", "upload_id=456");

// Loads audience.js against a stand-in page whose share endpoint echoes the
// audience it receives, the way Instagram's response reports it.
function loadPage({ phone = true, respond } = {}) {
  const window = new EventTarget();
  const sent = [];
  const warnings = [];
  window.fetch = async (url, options = {}) => {
    sent.push({ url, body: options.body });
    if (respond) {
      return respond();
    }
    const audience = new URLSearchParams(String(options.body)).get("audience");
    return new Response(JSON.stringify({ media: { id: 1, audience } }));
  };
  class XMLHttpRequest extends EventTarget {
    responseType = "";
    open(method, url) {
      this.url = url;
    }
    send(body) {
      sent.push({ url: this.url, body });
      const audience = new URLSearchParams(String(body)).get("audience");
      this.responseText = JSON.stringify({ media: { audience } });
      queueMicrotask(() => this.dispatchEvent(new Event("load")));
    }
    abort() {
      this.aborted = true;
    }
  }
  vm.runInNewContext(source, {
    window,
    document: {
      documentElement: { dataset: phone ? { igPlusPhone: "emulated" } : {} },
    },
    XMLHttpRequest,
    URLSearchParams,
    Request,
    CustomEvent,
    TypeError,
    console: { warn: (...args) => warnings.push(args) },
  });
  const handOff = (closeFriends, reshare, skipFacebook = false, mentions) =>
    window.dispatchEvent(
      new CustomEvent("ig-plus:handoff", {
        detail: { closeFriends, skipFacebook, reshare, mentions },
      }),
    );
  const shared = () =>
    new Promise((resolve) =>
      window.addEventListener(
        "ig-plus:shared",
        (event) => resolve(event.detail.status),
        { once: true },
      ),
    );
  return { window, XMLHttpRequest, sent, warnings, handOff, shared };
}

const params = (body) => Object.fromEntries(new URLSearchParams(String(body)));

test("leaves the share alone unless close friends was chosen", async () => {
  const page = loadPage();
  page.handOff(false);
  await page.window.fetch(SHARE_URL, { method: "POST", body: SHARE_BODY });
  assert.equal(page.sent[0].body, SHARE_BODY);
});

test("shares to close friends without cross-posting to Facebook", async () => {
  const page = loadPage();
  page.handOff(true);
  const status = page.shared();
  await page.window.fetch(SHARE_URL, { method: "POST", body: SHARE_BODY });
  const body = params(page.sent[0].body);
  assert.equal(body.audience, "besties");
  assert.equal(body.share_to_facebook, "false");
  assert.equal(body.share_to_fb_destination_id, undefined);
  assert.equal(body.upload_id, "123");
  assert.equal(await status, "close-friends");
});

test("applies close friends to one story only", async () => {
  const page = loadPage();
  page.handOff(true);
  await page.window.fetch(SHARE_URL, { method: "POST", body: SHARE_BODY });
  await page.window.fetch(SHARE_URL, { method: "POST", body: NEXT_BODY });
  assert.equal(params(page.sent[1].body).audience, undefined);
});

test("keeps close friends when Instagram retries a refused share", async () => {
  let refuse = true;
  const page = loadPage({
    respond: () => {
      const body = refuse ? { status: "fail", message: "Try again" } : {};
      refuse = false;
      return new Response(JSON.stringify(body), { status: 400 });
    },
  });
  page.handOff(true);
  const status = page.shared();
  await page.window.fetch(SHARE_URL, { method: "POST", body: SHARE_BODY });
  assert.equal(await status, "unknown");
  assert.deepEqual(page.warnings.at(-1).slice(1), ["Try again"]);
  await page.window.fetch(SHARE_URL, { method: "POST", body: SHARE_BODY });
  const retry = params(page.sent[1].body);
  assert.equal(retry.audience, "besties");
  assert.equal(retry.share_to_facebook, "false");
});

const signedBody = (fields) =>
  "caption=&configure_mode=1&share_to_facebook=true&upload_id=123" +
  `&signed_body=${encodeURIComponent(`SIGNATURE.${JSON.stringify(fields)}`)}` +
  "&fb_dtsg=token";

const signedFields = (body) => {
  const signed = params(body).signed_body;
  assert.ok(signed.startsWith("SIGNATURE."));
  return JSON.parse(signed.slice("SIGNATURE.".length));
};

test("amends the signed copy of the share's fields", async () => {
  const page = loadPage();
  page.handOff(true, null, false, MENTIONS);
  const body = signedBody({
    caption: "",
    share_to_facebook: "true",
    share_to_fb_destination_id: "abc",
    share_to_fb_destination_type: "USER",
    upload_id: "123",
  });
  await page.window.fetch(SHARE_URL, { method: "POST", body });
  const signed = signedFields(page.sent[0].body);
  assert.equal(signed.audience, "besties");
  assert.equal(signed.share_to_facebook, "false");
  assert.equal(signed.share_to_fb_destination_id, undefined);
  assert.equal(signed.share_to_fb_destination_type, undefined);
  assert.equal(signed.upload_id, "123");
  assert.equal(JSON.parse(signed.reel_mentions)[0].user_id, MENTIONS[0].userId);
  assert.equal(params(page.sent[0].body).audience, "besties");
});

test("stops a close friends share whose signed fields it cannot read", async () => {
  const page = loadPage();
  page.handOff(true);
  const status = page.shared();
  const body = SHARE_BODY + "&signed_body=SIGNATURE.not-json";
  await assert.rejects(page.window.fetch(SHARE_URL, { method: "POST", body }));
  assert.equal(page.sent.length, 0);
  assert.equal(await status, "blocked");
});

test("reads responses in Facebook's ajax wrapper", async () => {
  const page = loadPage({
    respond: () =>
      new Response(
        `for (;;);${JSON.stringify({ __ar: 1, payload: { media: { id: 1 } } })}`,
      ),
  });
  page.handOff(true);
  const status = page.shared();
  await page.window.fetch(SHARE_URL, { method: "POST", body: SHARE_BODY });
  assert.equal(await status, "public");
});

// A change event from a file input, as Instagram's own picker sends.
const pickFile = (window) => {
  const event = new Event("change");
  Object.defineProperty(event, "target", { value: { type: "file" } });
  window.dispatchEvent(event);
};

test("drops a discarded story's close friends when a new file is picked", async () => {
  const page = loadPage();
  page.handOff(true, RESHARE, true, MENTIONS);
  pickFile(page.window);
  await page.window.fetch(SHARE_URL, { method: "POST", body: SHARE_BODY });
  assert.equal(page.sent[0].body, SHARE_BODY);
});

test("keeps close friends handed off after the file is attached", async () => {
  const page = loadPage();
  pickFile(page.window);
  page.handOff(true);
  await page.window.fetch(SHARE_URL, { method: "POST", body: SHARE_BODY });
  assert.equal(params(page.sent[0].body).audience, "besties");
});

test("ignores other requests while close friends is pending", async () => {
  const page = loadPage();
  page.handOff(true);
  await page.window.fetch("/api/graphql", { method: "POST", body: "a=1" });
  assert.equal(page.sent[0].body, "a=1");
  await page.window.fetch(SHARE_URL, { method: "POST", body: SHARE_BODY });
  assert.equal(params(page.sent[1].body).audience, "besties");
});

test("stops a close friends share it cannot read", async () => {
  const page = loadPage();
  page.handOff(true);
  const status = page.shared();
  await assert.rejects(
    page.window.fetch(SHARE_URL, { method: "POST", body: new Blob(["x"]) }),
  );
  assert.equal(page.sent.length, 0);
  assert.equal(await status, "blocked");
});

test("amends shares sent with XMLHttpRequest", async () => {
  const page = loadPage();
  page.handOff(true);
  const status = page.shared();
  const request = new page.XMLHttpRequest();
  request.open("POST", SHARE_URL);
  request.send(SHARE_BODY);
  assert.equal(params(page.sent[0].body).audience, "besties");
  assert.equal(await status, "close-friends");
});

const RESHARE = {
  mediaId: "4023902473054651797",
  card: { x: 0.5, y: 0.45, width: 0.8, height: 0.5 },
};

test("links a shared post to the story", async () => {
  const page = loadPage();
  let notices = 0;
  page.window.addEventListener("ig-plus:shared", () => notices++);
  page.handOff(false, RESHARE);
  await page.window.fetch(SHARE_URL, { method: "POST", body: SHARE_BODY });
  const body = params(page.sent[0].body);
  assert.equal(body.reshared_media_id, RESHARE.mediaId);
  assert.equal(body.story_sticker_ids, `media_simple_${RESHARE.mediaId}`);
  const [sticker] = JSON.parse(body.attached_media);
  assert.equal(sticker.media_id, RESHARE.mediaId);
  assert.equal(sticker.y, 0.45);
  assert.equal(body.audience, undefined);
  assert.equal(body.share_to_facebook, "true");
  await page.window.fetch(SHARE_URL, { method: "POST", body: NEXT_BODY });
  assert.equal(params(page.sent[1].body).reshared_media_id, undefined);
  assert.equal(notices, 0);
});

test("links a shared post in a close friends story", async () => {
  const page = loadPage();
  page.handOff(true, RESHARE);
  const status = page.shared();
  await page.window.fetch(SHARE_URL, { method: "POST", body: SHARE_BODY });
  const body = params(page.sent[0].body);
  assert.equal(body.audience, "besties");
  assert.equal(body.reshared_media_id, RESHARE.mediaId);
  assert.equal(await status, "close-friends");
});

test("still shares a public story whose request it cannot read", async () => {
  const page = loadPage();
  page.handOff(false, RESHARE);
  const body = new Blob(["x"]);
  await page.window.fetch(SHARE_URL, { method: "POST", body });
  assert.equal(page.sent[0].body, body);
});

test("keeps a public story off Facebook when asked", async () => {
  const page = loadPage();
  let notices = 0;
  page.window.addEventListener("ig-plus:shared", () => notices++);
  page.handOff(false, null, true);
  await page.window.fetch(SHARE_URL, { method: "POST", body: SHARE_BODY });
  const body = params(page.sent[0].body);
  assert.equal(body.share_to_facebook, "false");
  assert.equal(body.share_to_fb_destination_id, undefined);
  assert.equal(body.share_to_fb_destination_type, undefined);
  assert.equal(body.audience, undefined);
  assert.equal(notices, 0);
  await page.window.fetch(SHARE_URL, { method: "POST", body: NEXT_BODY });
  assert.equal(params(page.sent[1].body).share_to_facebook, "true");
});

test("stops a story kept off Facebook that it cannot read", async () => {
  const page = loadPage();
  page.handOff(false, null, true);
  const status = page.shared();
  await assert.rejects(
    page.window.fetch(SHARE_URL, { method: "POST", body: new Blob(["x"]) }),
  );
  assert.equal(page.sent.length, 0);
  assert.equal(await status, "blocked-facebook");
});

test("waits for a video's processing before reporting", async () => {
  const page = loadPage({
    respond: () =>
      new Response(JSON.stringify({ message: "Transcode not finished yet." }), {
        status: 202,
      }),
  });
  const notices = [];
  page.window.addEventListener("ig-plus:shared", (event) =>
    notices.push(event.detail.status),
  );
  page.handOff(true);
  await page.window.fetch(SHARE_URL, { method: "POST", body: SHARE_BODY });
  await new Promise((resolve) => setTimeout(resolve));
  assert.deepEqual(notices, []);
});

test("does nothing outside phone tabs", async () => {
  const page = loadPage({ phone: false });
  page.handOff(true);
  await page.window.fetch(SHARE_URL, { method: "POST", body: SHARE_BODY });
  assert.equal(page.sent[0].body, SHARE_BODY);
});

test("never logs a share request it cannot read", async () => {
  const page = loadPage();
  page.handOff(true);
  const body = "fb_dtsg=token&caption=";
  await assert.rejects(page.window.fetch(SHARE_URL, { method: "POST", body }));
  assert.equal(page.warnings.length, 1);
  assert.ok(!page.warnings.flat().some((arg) => String(arg).includes("token")));
});

const MENTIONS = [
  {
    userId: "17841400000000001",
    box: { x: 0.4, y: 0.5, width: 0.2, height: 0.04 },
  },
];

test("tags the people the story mentions", async () => {
  const page = loadPage();
  let notices = 0;
  page.window.addEventListener("ig-plus:shared", () => notices++);
  page.handOff(false, null, false, MENTIONS);
  await page.window.fetch(SHARE_URL, { method: "POST", body: SHARE_BODY });
  const body = params(page.sent[0].body);
  const [mention] = JSON.parse(body.reel_mentions);
  assert.equal(mention.user_id, MENTIONS[0].userId);
  assert.equal(mention.type, "mention");
  assert.equal(mention.x, 0.4);
  assert.equal(mention.height, 0.04);
  assert.equal(body.audience, undefined);
  assert.equal(body.share_to_facebook, "true");
  assert.equal(notices, 0);
  await page.window.fetch(SHARE_URL, { method: "POST", body: NEXT_BODY });
  assert.equal(params(page.sent[1].body).reel_mentions, undefined);
});

test("shares a public story without its tags when it cannot read it", async () => {
  const page = loadPage();
  page.handOff(false, null, false, MENTIONS);
  const status = page.shared();
  const body = new Blob(["x"]);
  await page.window.fetch(SHARE_URL, { method: "POST", body });
  assert.equal(page.sent[0].body, body);
  assert.equal(await status, "untagged");
});
