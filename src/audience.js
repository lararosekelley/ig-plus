// Runs in the page's main world so it can amend Instagram's own request when a
// story should go to close friends only, skip Facebook, link to a post it
// shares, or tag the people its text mentions. Instagram's mobile web composer
// can do none of these, but the endpoint it shares through accepts the fields
// the phone apps send.
(() => {
  // mobile.js marks phone tabs before this runs.
  if (!document.documentElement.dataset.igPlusPhone) {
    return;
  }

  const SHARE_URL = /\/api\/v1\/media\/configure_to_story\//;

  // camera.js says whether the story it hands off is for close friends,
  // whether to skip Facebook, which post it shares, if any: { mediaId,
  // card } with the post's card as fractions of the story, and who its text
  // mentions: [{ userId, box }] with each box as fractions of the story.
  let closeFriends = false;
  let skipFacebook = false;
  let reshare = null;
  let mentions = [];
  window.addEventListener("ig-plus:handoff", (event) => {
    closeFriends = event.detail.closeFriends;
    skipFacebook = event.detail.skipFacebook ?? false;
    reshare = event.detail.reshare ?? null;
    mentions = event.detail.mentions ?? [];
  });
  // A file picked for a new story drops what a discarded one asked for.
  // camera.js attaches its file before the handoff, so its own stories keep
  // theirs.
  window.addEventListener(
    "change",
    (event) => {
      if (event.target?.type === "file") {
        closeFriends = skipFacebook = false;
        reshare = null;
        mentions = [];
      }
    },
    true,
  );

  function amend(body, { closeFriends, skipFacebook, reshare, mentions }) {
    const params = new URLSearchParams(
      body instanceof URLSearchParams || typeof body === "string" ? body : "",
    );
    if (!params.has("upload_id")) {
      return null;
    }
    // Field values to set, or null to remove the field.
    const fields = {};
    if (closeFriends) {
      fields.audience = "besties";
    }
    // The phone apps never cross-post close friends stories to Facebook.
    if (closeFriends || skipFacebook) {
      fields.share_to_facebook = "false";
      fields.share_to_fb_destination_id = null;
      fields.share_to_fb_destination_type = null;
    }
    if (reshare) {
      // The post's card is drawn into the story; this makes it tappable.
      const { mediaId, card } = reshare;
      fields.reshared_media_id = mediaId;
      fields.story_sticker_ids = `media_simple_${mediaId}`;
      fields.attached_media = JSON.stringify([
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
      ]);
    }
    if (mentions.length) {
      // The mentions are drawn into the story; these make them tappable and
      // notify the people mentioned.
      fields.reel_mentions = JSON.stringify(
        mentions.map(({ userId, box }) => ({
          ...box,
          z: 0,
          rotation: 0,
          type: "mention",
          user_id: userId,
          is_sticker: false,
          display_type: "mention_username",
        })),
      );
    }
    for (const [name, value] of Object.entries(fields)) {
      if (value === null) {
        params.delete(name);
      } else {
        params.set(name, value);
      }
    }
    // Instagram reads the fields from signed_body, "SIGNATURE.{json}", when
    // the request has one.
    const signed = params.get("signed_body");
    if (signed !== null) {
      const dot = signed.indexOf(".");
      let copy;
      try {
        copy = JSON.parse(signed.slice(dot + 1));
      } catch {}
      if (dot < 0 || !copy || typeof copy !== "object") {
        return null;
      }
      for (const [name, value] of Object.entries(fields)) {
        if (value === null) {
          delete copy[name];
        } else {
          copy[name] = value;
        }
      }
      params.set(
        "signed_body",
        `${signed.slice(0, dot)}.${JSON.stringify(copy)}`,
      );
    }
    return typeof body === "string" ? params.toString() : params;
  }

  // Reports whether Instagram applied the audience, so a story that went to
  // everyone is not mistaken for a close friends one.
  function report(response) {
    let data;
    try {
      data =
        typeof response === "string"
          ? JSON.parse(response.replace(/^for \(;;\);/, ""))
          : response;
    } catch {}
    // Instagram's web endpoints may answer in Facebook's ajax wrapper.
    if (data?.__ar) {
      data = data.payload ?? { message: data.errorSummary ?? data.error };
    }
    // A video still processing is shared again once it is ready.
    if (/transcode/i.test(data?.message ?? "")) {
      return;
    }
    const media = data?.media;
    let status = "unknown";
    let reason;
    if (media) {
      status = media.audience === "besties" ? "close-friends" : "public";
    } else {
      reason = String(
        data?.message ?? data?.status ?? "no readable response",
      ).slice(0, 200);
      console.warn(
        "IG Plus: Instagram refused the close friends share:",
        reason,
      );
    }
    window.dispatchEvent(
      new CustomEvent("ig-plus:shared", { detail: { status, reason } }),
    );
  }

  // Instagram's composer retries a share it was refused, so retries of the
  // last amended upload get the same amendment rather than going out as is.
  let last = null;

  function uploadId(body) {
    if (body instanceof URLSearchParams || typeof body === "string") {
      return new URLSearchParams(body).get("upload_id");
    }
    return null;
  }

  // Returns { body, closeFriends } with the amended body, null to leave the
  // request alone, or "block" when a close friends story, or one kept off
  // Facebook, cannot be amended and must not go out.
  function takeAmendment(method, url, body) {
    if (method.toUpperCase() !== "POST" || !SHARE_URL.test(url)) {
      return null;
    }
    let wanted;
    if (closeFriends || skipFacebook || reshare || mentions.length) {
      wanted = { closeFriends, skipFacebook, reshare, mentions };
      closeFriends = skipFacebook = false;
      reshare = null;
      mentions = [];
    } else if (last && last.uploadId === uploadId(body)) {
      wanted = last.wanted;
    } else {
      return null;
    }
    const amended = amend(body, wanted);
    if (amended) {
      last = { uploadId: uploadId(amended), wanted };
    }
    if (!amended) {
      console.warn(
        "IG Plus could not read the share request, a",
        body?.constructor?.name ?? typeof body,
      );
      if (!wanted.closeFriends && !wanted.skipFacebook) {
        if (wanted.mentions.length) {
          window.dispatchEvent(
            new CustomEvent("ig-plus:shared", {
              detail: { status: "untagged" },
            }),
          );
        }
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
