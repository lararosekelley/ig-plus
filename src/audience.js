// Runs in the page's main world so it can amend Instagram's own request when a
// story should go to close friends only, skip Facebook, or link to a post it
// shares. Instagram's mobile web composer can do none of these, but the
// endpoint it shares through accepts the fields the phone apps send.
(() => {
  // mobile.js marks phone tabs before this runs.
  if (!document.documentElement.dataset.igPlusPhone) {
    return;
  }

  const SHARE_URL = /\/api\/v1\/media\/configure_to_story\//;

  // camera.js says whether the story it hands off is for close friends,
  // whether to skip Facebook, and which post it shares, if any: { mediaId,
  // card } with the post's card as fractions of the story.
  let closeFriends = false;
  let skipFacebook = false;
  let reshare = null;
  window.addEventListener("ig-plus:handoff", (event) => {
    closeFriends = event.detail.closeFriends;
    skipFacebook = event.detail.skipFacebook ?? false;
    reshare = event.detail.reshare ?? null;
  });

  function amend(body, { closeFriends, skipFacebook, reshare }) {
    const params = new URLSearchParams(
      body instanceof URLSearchParams || typeof body === "string" ? body : "",
    );
    if (!params.has("upload_id")) {
      return null;
    }
    if (closeFriends) {
      params.set("audience", "besties");
    }
    // The phone apps never cross-post close friends stories to Facebook.
    if (closeFriends || skipFacebook) {
      params.set("share_to_facebook", "false");
      params.delete("share_to_fb_destination_id");
      params.delete("share_to_fb_destination_type");
    }
    if (reshare) {
      // The post's card is drawn into the story; this makes it tappable.
      const { mediaId, card } = reshare;
      params.set("reshared_media_id", mediaId);
      params.set("story_sticker_ids", `media_simple_${mediaId}`);
      params.set(
        "attached_media",
        JSON.stringify([
          {
            ...card,
            z: 0,
            rotation: 0,
            type: "feed_media",
            media_id: mediaId,
            product_type: "feed",
            is_sticker: true,
            tap_state: 0,
            tap_state_str_id: "feed_post_sticker_square",
          },
        ]),
      );
    }
    return typeof body === "string" ? params.toString() : params;
  }

  // Reports whether Instagram applied the audience, so a story that went to
  // everyone is not mistaken for a close friends one.
  function report(response) {
    let data;
    try {
      data = typeof response === "string" ? JSON.parse(response) : response;
    } catch {}
    // A video still processing is shared again once it is ready.
    if (/transcode/i.test(data?.message ?? "")) {
      return;
    }
    const media = data?.media;
    let status = "unknown";
    if (media) {
      status = media.audience === "besties" ? "close-friends" : "public";
    }
    window.dispatchEvent(
      new CustomEvent("ig-plus:shared", { detail: { status } }),
    );
  }

  // Returns { body, closeFriends } with the amended body, null to leave the
  // request alone, or "block" when a close friends story, or one kept off
  // Facebook, cannot be amended and must not go out.
  function takeAmendment(method, url, body) {
    if (
      (!closeFriends && !skipFacebook && !reshare) ||
      method.toUpperCase() !== "POST" ||
      !SHARE_URL.test(url)
    ) {
      return null;
    }
    const wanted = { closeFriends, skipFacebook, reshare };
    closeFriends = skipFacebook = false;
    reshare = null;
    const amended = amend(body, wanted);
    if (!amended) {
      console.warn("IG Plus could not read the share request:", body);
      if (!wanted.closeFriends && !wanted.skipFacebook) {
        return null;
      }
      const status = wanted.closeFriends ? "blocked" : "blocked-facebook";
      window.dispatchEvent(
        new CustomEvent("ig-plus:shared", { detail: { status } }),
      );
      return "block";
    }
    return { body: amended, closeFriends: wanted.closeFriends };
  }

  const nativeFetch = window.fetch;
  window.fetch = function (resource, options = {}) {
    const request = resource instanceof Request ? resource : null;
    const url = request ? request.url : String(resource);
    const method = options.method ?? request?.method ?? "GET";
    const amended = takeAmendment(method, url, options.body);
    if (!amended) {
      return nativeFetch.apply(this, arguments);
    }
    if (amended === "block") {
      return Promise.reject(
        new TypeError("Close friends could not be applied"),
      );
    }
    const response = nativeFetch.call(this, resource, {
      ...options,
      body: amended.body,
    });
    if (amended.closeFriends) {
      response.then((result) => result.clone().text()).then(report, () => {});
    }
    return response;
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const requests = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url) {
    requests.set(this, { method, url: String(url) });
    return nativeOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const { method = "GET", url = "" } = requests.get(this) ?? {};
    const amended = takeAmendment(method, url, body);
    if (!amended) {
      return nativeSend.apply(this, arguments);
    }
    if (amended === "block") {
      this.abort();
      return;
    }
    if (amended.closeFriends) {
      this.addEventListener("load", () =>
        report(
          this.responseType === "json" ? this.response : this.responseText,
        ),
      );
    }
    return nativeSend.call(this, amended.body);
  };
})();
