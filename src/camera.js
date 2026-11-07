// Runs in the page's main world so it can intercept Instagram's file inputs.
(() => {
  // mobile.js marks phone tabs before this runs.
  if (!document.documentElement.dataset.igPlusPhone) {
    return;
  }

  const nativeClick = HTMLInputElement.prototype.click;
  const nativeShowPicker = HTMLInputElement.prototype.showPicker;
  let bypass = false;

  // Posts and stories open the same kind of file input, so only take over when
  // the click that led to it was on something about stories, such as the
  // Story menu item or the story bubble.
  const STORY_CLICK_WINDOW = 3000;
  let lastStoryClick = 0;

  const CONTROL =
    'a, button, label, [role="button"], [role="menuitem"], [role="link"]';

  // Looks only up to the clicked control, since a menu around it may list
  // both Post and Story.
  function mentionsStory(event) {
    for (const node of event.composedPath()) {
      if (!(node instanceof Element)) {
        return false;
      }
      const text = node.textContent.length <= 40 ? node.textContent : "";
      if (
        /\bstor(y|ies)\b/i.test(
          `${node.getAttribute("aria-label") ?? ""} ${text}`,
        )
      ) {
        return true;
      }
      if (node.matches(CONTROL)) {
        return false;
      }
    }
    return false;
  }

  // Set while IG Plus opens Instagram's story composer itself, for a story
  // already made from the feed: the composer's file input goes to it instead
  // of the camera.
  let inputWaiter = null;
  function claimInput(element) {
    if (
      !inputWaiter ||
      !(element instanceof HTMLInputElement) ||
      element.type !== "file"
    ) {
      return false;
    }
    inputWaiter(element);
    return true;
  }

  function wantsCamera(element) {
    return (
      !bypass &&
      element instanceof HTMLInputElement &&
      element.type === "file" &&
      (!element.accept || element.accept.includes("image")) &&
      Date.now() - lastStoryClick < STORY_CLICK_WINDOW
    );
  }

  function openPicker(input) {
    bypass = true;
    try {
      nativeClick.call(input);
    } finally {
      bypass = false;
    }
  }

  // Clicks on connected inputs reach the listener below; detached inputs
  // never dispatch to the window, so catch them here.
  HTMLInputElement.prototype.click = function () {
    if (claimInput(this)) {
      return;
    }
    if (wantsCamera(this) && !this.isConnected) {
      showCamera(this);
      return;
    }
    return nativeClick.call(this);
  };

  HTMLInputElement.prototype.showPicker = function () {
    if (claimInput(this)) {
      return;
    }
    if (wantsCamera(this)) {
      showCamera(this);
      return;
    }
    return nativeShowPicker.call(this);
  };

  window.addEventListener(
    "click",
    (event) => {
      if (mentionsStory(event)) {
        lastStoryClick = Date.now();
      }
      if (claimInput(event.target)) {
        event.preventDefault();
        return;
      }
      if (wantsCamera(event.target)) {
        event.preventDefault();
        showCamera(event.target);
      }
    },
    true,
  );

  // The last post or reel this tab showed, offered when sharing a post. Paths
  // look like /p/CODE/, /reel/CODE/, or /username/p/CODE/, while a reel's
  // sound has a page at /reels/audio/ID/.
  const POST_PATH = /^\/(?:[\w.]+\/)?(?:p|reels?|tv)\/(?!audio\/)([\w-]+)/;
  function rememberPost(url) {
    const shortcode = new URL(url, location.href).pathname.match(
      POST_PATH,
    )?.[1];
    if (shortcode) {
      sessionStorage.setItem("ig-plus:post", shortcode);
    }
  }
  rememberPost(location.href);
  navigation.addEventListener("navigate", (event) =>
    rememberPost(event.destination.url),
  );

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Opens Instagram's story composer the way a person would, through New post
  // and then Story, and resolves to the file input it opens.
  function requestStoryInput() {
    return new Promise((resolve, reject) => {
      const fail = (error) => {
        clearTimeout(timeout);
        inputWaiter = null;
        reject(error);
      };
      const timeout = setTimeout(
        () => fail(new Error("Instagram's story composer did not open")),
        8000,
      );
      inputWaiter = (input) => {
        clearTimeout(timeout);
        inputWaiter = null;
        resolve(input);
      };
      openStoryMenu().catch(fail);
    });
  }

  // Polls for an element, since Instagram renders menus and headers late.
  async function find(lookup, tries = 20) {
    for (let attempt = 0; attempt < tries; attempt++) {
      const found = lookup();
      if (found) {
        return found;
      }
      await wait(100);
    }
    return null;
  }

  async function openStoryMenu() {
    // The phone layout's plus is a bare icon in a plain element, so fall back
    // to clicking the icon itself.
    const newPostButton = () => {
      const plus = document.querySelector(
        'svg[aria-label="New post"], svg[aria-label="Create"], svg[aria-label="Plus icon"]',
      );
      return plus?.closest(CONTROL) ?? plus;
    };
    // The phone layout has the plus only in the home feed's header, which
    // goes away while scrolling down.
    if (!newPostButton()) {
      const home = document
        .querySelector('svg[aria-label="Home"]')
        ?.closest("a");
      if (location.pathname !== "/" && home) {
        home.click();
      } else {
        window.scrollTo(0, 0);
      }
    }
    const newPost = await find(newPostButton, 50);
    if (!newPost) {
      console.warn(
        "IG Plus looked for the plus button among:",
        [...document.querySelectorAll("svg[aria-label]")].map((svg) =>
          svg.getAttribute("aria-label"),
        ),
      );
      throw new Error("could not find Instagram's plus button");
    }
    newPost.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
    // The phone layout's plus may open the story picker straight away, which
    // settles the wait for the input; otherwise it opens a menu with Story.
    const story = await find(
      () =>
        !inputWaiter ||
        [...document.querySelectorAll(CONTROL)].find((control) =>
          /^\s*story\s*$/i.test(control.textContent),
        ),
      30,
    );
    if (story === true) {
      return;
    }
    if (!story) {
      throw new Error("could not find Instagram's Story option");
    }
    story.click();
  }

  // Puts "Add to story" just left of the Save button of each post in the
  // feed, which sits at the right end of the post's actions.
  function addStoryButtons() {
    for (const save of document.querySelectorAll(
      'article svg[aria-label="Save"], article svg[aria-label="Remove"]',
    )) {
      const article = save.closest("article");
      const control = save.closest(CONTROL);
      const share = article.querySelector('svg[aria-label="Share"]');
      if (!control || !share || article.querySelector("[data-ig-plus-story]")) {
        continue;
      }
      // The part of the action row that holds Save, which Instagram pushes to
      // the right; the button goes in it, laid out in a row.
      let group = control;
      while (!group.parentElement.contains(share)) {
        group = group.parentElement;
      }
      const shortcode = [...article.querySelectorAll("a[href]")]
        .map((link) => new URL(link.href).pathname.match(POST_PATH)?.[1])
        .find(Boolean);
      if (!shortcode) {
        continue;
      }
      loadFont();
      const host = element("span");
      host.dataset.igPlusStory = "";
      host.style.cssText =
        "display: inline-flex; align-items: center; margin-right: 12px; position: relative; top: -3px;";
      Object.assign(group.style, { display: "flex", alignItems: "center" });
      const root = host.attachShadow({ mode: "closed" });
      root.adoptedStyleSheets = [styles];
      const button = element("button", {
        className: "primary story-button",
        textContent: "Add to story",
      });
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        showCamera(null, shortcode);
      };
      root.append(button);
      group.prepend(host);
    }
  }

  // Webcams are landscape, and Instagram crops anything that is not 9:16.
  const STORY = { width: 1080, height: 1920 };

  const TEXT_STYLES = [
    { fill: "#fff", shadow: true },
    { fill: "#000" },
    { fill: "#fff", box: "#000" },
    { fill: "#000", box: "#fff" },
  ];

  // One color is a solid fill; more make a diagonal gradient.
  const BACKGROUNDS = [
    ["#000000"],
    ["#ffffff"],
    ["#e1306c"],
    ["#405de6"],
    ["#fcaf45"],
    ["#2e8b57"],
    ["#833ab4", "#fd1d1d", "#fcb045"],
    ["#405de6", "#c13584"],
    ["#ff9a9e", "#fecfef"],
    ["#0f2027", "#2c5364"],
    ["#f7971e", "#ffd200"],
    ["#00c6ff", "#0072ff"],
  ];

  const BRUSH_COLORS = [
    "#ffffff",
    "#000000",
    "#ff3b30",
    "#ff9500",
    "#ffcc00",
    "#34c759",
    "#0a84ff",
    "#af52de",
    "#f08fb8",
  ];

  // Instagram's own fonts are not reachable from the page, so these use fonts
  // installed locally, falling back to generic families elsewhere.
  const FONTS = [
    { name: "Classic", font: (size) => `bold ${size}px system-ui, sans-serif` },
    {
      name: "Elegant",
      font: (size) => `italic ${size}px P052, Palatino, serif`,
    },
    { name: "Script", font: (size) => `${size}px Z003, cursive` },
  ];

  // Constructed stylesheets and DOM APIs avoid Instagram's CSP and Trusted
  // Types restrictions on inline styles and HTML strings.
  const styles = new CSSStyleSheet();
  styles.replaceSync(`
    /* Callie and Callie Light, from Callie's theme files. */
    :host {
      --background: #fbf5f8;
      --surface: #fffafc;
      --surface-alt: #f3e7ee;
      --border: #e0ccd7;
      --text: #2b1a26;
      --text-muted: #6b5562;
      --accent: #c2407a;
      --accent-text: #fffafc;
      --edge: #dcc8d3;
      --accent-edge: #8e2c5a;
      --danger: #c93c45;
      --danger-edge: #902b31;
      --danger-text: #fbf5f8;
      --done: #3f7b4a;
      --shadow: rgba(92, 42, 71, 0.18);
      --font: Nunito, system-ui, sans-serif;
      /* Quick, with a little overshoot when something arrives. */
      --bounce: cubic-bezier(0.34, 1.4, 0.64, 1);
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --background: #1c1220;
        --surface: #261a2a;
        --surface-alt: #33243a;
        --border: #3d2c42;
        --text: #f6eef5;
        --text-muted: #c9b7c6;
        --accent: #f08fb8;
        --accent-text: #2e0f20;
        --edge: #140c17;
        --accent-edge: #a64b7a;
        --danger: #e66e6d;
        --danger-edge: #a44f4e;
        --danger-text: #1c1220;
        --done: #9dcca3;
        --shadow: rgba(0, 0, 0, 0.5);
      }
    }
    [hidden] {
      display: none !important;
    }
    .overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      background: var(--background);
      color: var(--text);
      font: 13px/1.4 var(--font);
      animation: arrive 200ms var(--bounce);
    }
    @keyframes arrive {
      from {
        opacity: 0;
        transform: scale(0.96);
      }
    }
    .stage {
      position: relative;
      flex: 1;
      min-height: 0;
      margin: 12px 12px 0;
      overflow: hidden;
      border-radius: 14px;
      background: #000;
      container-type: size;
    }
    /* Phones taller than 9:16 fill the screen with a story, cutting about 9%
       from each side. */
    .guide {
      position: absolute;
      inset: 0;
      width: min(100cqw, 100cqh * 9 / 16);
      height: min(100cqh, 100cqw * 16 / 9);
      margin: auto;
      pointer-events: none;
    }
    .guide::before,
    .guide::after {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      width: 9%;
      background: rgb(0 0 0 / 0.35);
    }
    .guide::before {
      left: 0;
      border-right: 1px dashed rgb(255 255 255 / 0.6);
    }
    .guide::after {
      right: 0;
      border-left: 1px dashed rgb(255 255 255 / 0.6);
    }
    canvas[hidden] ~ .guide {
      display: none;
    }
    video,
    canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    video {
      transform: scaleX(-1);
    }
    canvas {
      touch-action: none;
    }
    .backdrop {
      object-fit: cover;
      filter: blur(30px) brightness(0.7);
      transform: scaleX(-1) scale(1.1);
    }
    .fill .backdrop {
      display: none;
    }
    .fill .main {
      object-fit: cover;
    }
    .message {
      padding: 8px 16px 0;
      color: var(--text-muted);
      font-weight: 600;
      text-align: center;
    }
    .link {
      padding: 12px 16px 0;
    }
    .story-button {
      padding: 4px 12px;
      font-size: 13px;
      white-space: nowrap;
    }
    .source {
      position: fixed;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }
    .controls {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 16px 0;
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      color: var(--text-muted);
      font-weight: 700;
    }
    input[type="range"] {
      flex: 1;
      accent-color: var(--accent);
    }
    textarea,
    input[type="text"] {
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: 11px;
      background: var(--surface);
      color: inherit;
      font: inherit;
      font-size: 14px;
      resize: none;
    }
    input[type="text"] {
      flex: 1;
      min-width: 0;
    }
    textarea::placeholder,
    input[type="text"]::placeholder {
      color: var(--text-muted);
    }
    :focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .picker {
      display: flex;
      gap: 4px;
      align-items: center;
      padding: 12px 8px 4px;
    }
    .swatches {
      display: flex;
      flex: 1;
      gap: 12px;
      overflow-x: auto;
      scrollbar-width: none;
      /* Room for the selected swatch's outline. */
      padding: 4px;
    }
    .arrow {
      flex: none;
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      padding: 0;
      background: transparent;
      box-shadow: none;
      color: var(--text-muted);
    }
    .arrow:disabled {
      opacity: 0.3;
    }
    .arrow svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .swatch {
      flex: none;
      width: 36px;
      height: 36px;
      padding: 0;
      border: 2px solid var(--border);
      border-radius: 50%;
      box-shadow: none;
    }
    .swatch.small {
      width: 28px;
      height: 28px;
    }
    .swatch.selected {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    /* Like Callie's view switcher: plain until chosen, then a pink sticker. */
    .tools button {
      background: transparent;
      box-shadow: none;
      color: var(--text-muted);
    }
    .tools button[aria-pressed="true"] {
      background: var(--accent);
      box-shadow: 0 3px 0 var(--accent-edge);
      color: var(--accent-text);
      font-weight: 800;
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
      padding: 12px 16px 16px;
    }
    /* Pressable things are stickers, raised on an edge in a darker shade. */
    button {
      padding: 8px 14px;
      border: 0;
      border-radius: 11px;
      background: var(--surface-alt);
      box-shadow: 0 3px 0 var(--edge);
      color: var(--text);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      transition:
        transform 140ms,
        box-shadow 140ms;
    }
    button:active:not(:disabled) {
      transform: translateY(3px);
      box-shadow: 0 0 0 var(--edge);
    }
    button.primary {
      background: var(--accent);
      box-shadow: 0 3px 0 var(--accent-edge);
      color: var(--accent-text);
      font-weight: 800;
    }
    button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    /* Like Callie's DangerButton: a red label, filled red while it waits for
       the click that confirms. */
    button.destructive {
      color: var(--danger);
    }
    button.destructive.armed {
      background: var(--danger);
      box-shadow: 0 3px 0 var(--danger-edge);
      color: var(--danger-text);
      font-weight: 800;
    }
    /* Like the git-stk tour's checkboxes: a ring that fills when checked. */
    .check {
      position: relative;
      display: inline-flex;
      gap: 8px;
      align-items: center;
      padding: 8px 4px;
      color: var(--text-muted);
      font-weight: 700;
      cursor: pointer;
    }
    .check input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .check .box {
      display: grid;
      place-items: center;
      width: 18px;
      height: 18px;
      border: 2px solid var(--text-muted);
      border-radius: 50%;
      box-sizing: border-box;
    }
    .check svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: var(--background);
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
      visibility: hidden;
    }
    .check input:checked + .box {
      border-color: var(--done);
      background: var(--done);
    }
    .check input:checked + .box svg {
      visibility: visible;
    }
    .check input:checked ~ span {
      color: var(--text);
    }
    .check input:focus-visible + .box {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .floating {
      position: fixed;
      top: 12px;
      left: 12px;
      z-index: 2147483647;
      display: flex;
      gap: 8px;
      align-items: center;
      font: 13px/1.4 var(--font);
      animation: arrive 200ms var(--bounce);
    }
    .floating button {
      box-shadow:
        0 3px 0 var(--edge),
        0 14px 36px var(--shadow);
    }
    .badge {
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--done);
      color: var(--background);
      font-weight: 800;
    }
    .notice {
      position: fixed;
      top: 12px;
      left: 50%;
      z-index: 2147483647;
      width: min(360px, calc(100vw - 24px));
      padding: 12px 16px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--surface);
      box-shadow: 0 14px 36px var(--shadow);
      color: var(--text);
      font: 600 13px/1.4 var(--font);
      transform: translateX(-50%);
      cursor: pointer;
    }
    .notice.warning {
      border-color: var(--danger);
    }
    @media (prefers-reduced-motion: reduce) {
      .overlay,
      .floating {
        animation: none;
      }
      button {
        transition: none;
      }
    }
  `);

  function element(tag, properties = {}) {
    return Object.assign(document.createElement(tag), properties);
  }

  // Built as DOM rather than a CSS image, which Instagram's CSP could block.
  const ICONS = {
    left: "M10 3.5 5.5 8l4.5 4.5",
    right: "M6 3.5 10.5 8 6 12.5",
    check: "M4 8.5 6.8 11 12 5.5",
  };

  function icon(name) {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", ICONS[name]);
    svg.append(path);
    return svg;
  }

  // Like Callie's DangerButton: the first click arms it, and a second within
  // a few seconds confirms.
  function confirmingButton(label, armedLabel, onConfirm) {
    const button = element("button", {
      className: "destructive",
      textContent: label,
    });
    let disarm;
    button.onclick = () => {
      if (button.classList.contains("armed")) {
        clearTimeout(disarm);
        onConfirm();
        return;
      }
      button.classList.add("armed");
      button.textContent = armedLabel;
      disarm = setTimeout(() => {
        button.classList.remove("armed");
        button.textContent = label;
      }, 4000);
    };
    return button;
  }

  function fitScale(image, fit) {
    return (fit === "cover" ? Math.max : Math.min)(
      STORY.width / image.width,
      STORY.height / image.height,
    );
  }

  function drawScaled(context, image, scale, x = 0, y = 0) {
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(
      image,
      (STORY.width - width) / 2 + x,
      (STORY.height - height) / 2 + y,
      width,
      height,
    );
  }

  // A blurred copy of the photo filling the frame, so any part of it the photo
  // does not cover still looks intentional. Made once per photo: Firefox blurs
  // canvases on the CPU, too slowly to repeat while dragging.
  function blurredBackdrop(image) {
    const canvas = element("canvas", STORY);
    const context = canvas.getContext("2d");
    context.filter = "blur(60px) brightness(0.7)";
    drawScaled(context, image, fitScale(image, "cover") * 1.1);
    return canvas;
  }

  function drawPhoto(context, { image, backdrop, zoom, x, y }) {
    context.drawImage(backdrop, 0, 0);
    drawScaled(context, image, fitScale(image, "contain") * zoom, x, y);
  }

  function captureFrame(video) {
    const canvas = element("canvas", {
      width: video.videoWidth,
      height: video.videoHeight,
    });
    const context = canvas.getContext("2d");
    // Match the mirrored preview.
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0);
    return canvas;
  }

  function cssBackground(colors) {
    return colors.length === 1
      ? colors[0]
      : `linear-gradient(135deg, ${colors.join(", ")})`;
  }

  function drawBackground(context, colors) {
    if (colors.length === 1) {
      context.fillStyle = colors[0];
    } else {
      const gradient = context.createLinearGradient(
        0,
        0,
        STORY.width,
        STORY.height,
      );
      colors.forEach((color, index) =>
        gradient.addColorStop(index / (colors.length - 1), color),
      );
      context.fillStyle = gradient;
    }
    context.fillRect(0, 0, STORY.width, STORY.height);
  }

  function wrapLines(context, value, maxWidth) {
    return value.split("\n").flatMap((paragraph) => {
      const lines = [];
      let line = "";
      for (const word of paragraph.split(" ")) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && context.measureText(candidate).width > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      return [...lines, line];
    });
  }

  function drawText(context, { value, x, y, size, style, font }) {
    if (!value.trim()) {
      return;
    }
    const { fill, box, shadow } = TEXT_STYLES[style];
    const lineHeight = size * 1.25;
    context.save();
    context.font = FONTS[font].font(size);
    context.textAlign = "center";
    context.textBaseline = "middle";
    const lines = wrapLines(context, value, STORY.width * 0.85);
    const top = y - (lineHeight * (lines.length - 1)) / 2;
    lines.forEach((line, index) => {
      const lineY = top + index * lineHeight;
      if (box && line) {
        const width = context.measureText(line).width + size * 0.6;
        context.fillStyle = box;
        context.beginPath();
        context.roundRect(
          x - width / 2,
          lineY - lineHeight / 2,
          width,
          lineHeight,
          size * 0.25,
        );
        context.fill();
      }
      if (shadow) {
        context.shadowColor = "rgba(0, 0, 0, 0.6)";
        context.shadowBlur = size * 0.2;
      }
      context.fillStyle = fill;
      context.fillText(line, x, lineY);
      context.shadowColor = "transparent";
    });
    context.restore();
  }

  function drawStrokes(context, strokes) {
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const { color, size, points } of strokes) {
      context.strokeStyle = color;
      context.lineWidth = size;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      // A single point still draws a dot thanks to the round cap.
      for (const point of points) {
        context.lineTo(point.x, point.y);
      }
      context.stroke();
    }
    context.restore();
  }

  // Shortcodes are the media ID in base 64.
  const SHORTCODE_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function shortcodeMediaId(shortcode) {
    let id = 0n;
    for (const char of shortcode.slice(0, 11)) {
      id = id * 64n + BigInt(SHORTCODE_ALPHABET.indexOf(char));
    }
    return id.toString();
  }

  function shortcodeOf(value) {
    const trimmed = value.trim();
    if (/^[\w-]{5,}$/.test(trimmed)) {
      return trimmed;
    }
    try {
      return new URL(trimmed, location.href).pathname.match(POST_PATH)?.[1];
    } catch {
      return undefined;
    }
  }

  // Instagram's API wants the web app's ID, which its pages carry.
  function appId() {
    return (
      document.documentElement.innerHTML.match(/"APP_ID":"(\d+)"/)?.[1] ??
      "936619743392459"
    );
  }

  // Instagram's own requests carry headers that identify the web app and the
  // session. Video stories go out without Instagram's composer, so they reuse
  // the latest of each.
  const SESSION_HEADER =
    /^x-(csrftoken|ig-app-id|asbd-id|instagram-ajax|ig-www-claim|web-device-id|web-session-id|mid)$/i;
  const sessionHeaders = {};
  const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (SESSION_HEADER.test(name)) {
      sessionHeaders[name.toLowerCase()] = value;
    }
    return nativeSetRequestHeader.apply(this, arguments);
  };
  function apiHeaders() {
    return {
      "x-csrftoken": document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1],
      "x-ig-app-id": appId(),
      "x-requested-with": "XMLHttpRequest",
      ...sessionHeaders,
    };
  }

  async function failure(response) {
    const text = await response.text();
    let detail = text.slice(0, 200);
    try {
      detail = JSON.parse(text).message ?? detail;
    } catch {}
    return new Error(`Instagram answered ${response.status}: ${detail}`);
  }

  // Instagram's phone layout only takes photos for stories, so video stories
  // go up the way its desktop site uploads videos for posts, then share with
  // the phone apps' story video fields. `handOff` tells audience.js what to
  // add to the share, and runs before each attempt.
  async function postVideoStory(file, { width, height, durationMs }, handOff) {
    const uploadId = String(Date.now());
    const {
      "x-ig-www-claim": _claim,
      "x-web-device-id": _device,
      ...headers
    } = apiHeaders();
    const upload = await fetch(
      `https://i.instagram.com/rupload_igvideo/fb_uploader_${uploadId}`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          ...headers,
          Offset: "0",
          "X-Entity-Length": String(file.size),
          "X-Entity-Name": `fb_uploader_${uploadId}`,
          "X-Instagram-Rupload-Params": JSON.stringify({
            "client-passthrough": "1",
            is_unified_video: "0",
            extract_cover_frame: "1",
            for_album: false,
            is_sidecar: "0",
            media_type: 2,
            upload_id: uploadId,
            upload_media_duration_ms: durationMs,
            upload_media_height: height,
            upload_media_width: width,
            video_format: file.type,
            video_transform: null,
          }),
        },
        body: file,
      },
    );
    if (!upload.ok) {
      throw await failure(upload);
    }
    const seconds = String(durationMs / 1000);
    const body = new URLSearchParams({
      upload_id: uploadId,
      caption: "",
      configure_mode: "1",
      source_type: "4",
      length: seconds,
      clips: JSON.stringify([{ length: seconds, source_type: "4" }]),
      poster_frame_index: "0",
      audio_muted: "false",
      filter_type: "0",
      video_result: "",
    }).toString();
    // Instagram processes the video after the upload and says so until done.
    for (let attempt = 0; attempt < 30; attempt++) {
      handOff();
      const response = await fetch(
        "/api/v1/media/configure_to_story/?video=1",
        {
          method: "POST",
          credentials: "include",
          headers: {
            ...apiHeaders(),
            "content-type": "application/x-www-form-urlencoded",
          },
          body,
        },
      );
      if (response.status === 202) {
        await wait(2000);
        continue;
      }
      if (!response.ok) {
        const error = await failure(response);
        if (/transcode/i.test(error.message)) {
          await wait(2000);
          continue;
        }
        throw error;
      }
      return;
    }
    throw new Error("Instagram did not finish processing the video");
  }

  async function loadImage(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Instagram answered ${response.status}`);
    }
    return createImageBitmap(await response.blob());
  }

  // Everything needed to draw a post's card: its first photo or the cover of
  // its video, and who posted it. A video is only needed once Done records
  // it, so it downloads meanwhile, to a promised blob URL.
  async function loadPost(shortcode) {
    const response = await fetch(
      `/api/v1/media/${shortcodeMediaId(shortcode)}/info/`,
      { headers: { "X-IG-App-ID": appId() } },
    );
    if (!response.ok) {
      throw new Error(`Instagram answered ${response.status}`);
    }
    const [item] = (await response.json()).items ?? [];
    if (!item) {
      throw new Error("Instagram did not return the post");
    }
    const media = item.carousel_media?.[0] ?? item;
    const [videoVersion] = media.video_versions ?? [];
    const video =
      videoVersion &&
      fetch(videoVersion.url)
        .then((result) => result.blob())
        .then((blob) => URL.createObjectURL(blob));
    // Reported when Done waits for it, not as an unhandled rejection.
    video?.catch(() => {});
    const [image, avatar] = await Promise.all([
      loadImage(media.image_versions2.candidates[0].url),
      loadImage(item.user.profile_pic_url).catch(() => null),
    ]);
    return {
      // The ID in JSON is a string; pk is a number too large to be exact.
      mediaId: String(item.id).split("_")[0],
      username: item.user.username,
      image,
      avatar,
      video,
      duration: media.video_duration ?? 0,
    };
  }

  // A post's card is a white rounded card with the poster above the photo,
  // like the phone apps draw, centered and then scaled and moved by the
  // editor's photo tool.
  const CARD = { width: 864, maxMedia: 1152, header: 112, radius: 36 };
  function cardRect({ post, zoom, x, y }) {
    const aspect = post.image.height / post.image.width;
    const media = Math.min(CARD.width * aspect, CARD.maxMedia) * zoom;
    const width = (media / aspect) | 0;
    const header = CARD.header * zoom;
    const height = header + media;
    return {
      left: (STORY.width - width) / 2 + x,
      top: (STORY.height - height) / 2 + y,
      width,
      height,
      header,
      scale: zoom,
    };
  }

  function drawCard(context, base, frame) {
    const { left, top, width, height, header, scale } = cardRect(base);
    const radius = CARD.radius * scale;
    context.drawImage(base.backdrop, 0, 0);
    context.save();
    context.shadowColor = "rgba(0, 0, 0, 0.35)";
    context.shadowBlur = 40 * scale;
    context.fillStyle = "#fff";
    context.beginPath();
    context.roundRect(left, top, width, height, radius);
    context.fill();
    context.restore();

    context.save();
    context.beginPath();
    context.roundRect(left, top, width, height, radius);
    context.clip();
    context.drawImage(frame, left, top + header, width, height - header);
    context.restore();

    const avatarSize = 64 * scale;
    const avatarX = left + 28 * scale;
    const avatarY = top + (header - avatarSize) / 2;
    if (base.post.avatar) {
      context.save();
      context.beginPath();
      context.arc(
        avatarX + avatarSize / 2,
        avatarY + avatarSize / 2,
        avatarSize / 2,
        0,
        Math.PI * 2,
      );
      context.clip();
      context.drawImage(
        base.post.avatar,
        avatarX,
        avatarY,
        avatarSize,
        avatarSize,
      );
      context.restore();
    }
    context.fillStyle = "#262626";
    context.font = `700 ${34 * scale}px system-ui, sans-serif`;
    context.textBaseline = "middle";
    context.fillText(
      base.post.username,
      avatarX + avatarSize + 20 * scale,
      top + header / 2,
      width - avatarSize - 76 * scale,
    );
  }

  // Where the card sits, as fractions of the story, for Instagram's tap area.
  function cardSticker(base) {
    const { left, top, width, height } = cardRect(base);
    return {
      x: (left + width / 2) / STORY.width,
      y: (top + height / 2) / STORY.height,
      width: width / STORY.width,
      height: height / STORY.height,
    };
  }

  // Instagram takes MP4 uploads; Firefox can only record WebM.
  const RECORDING_TYPES = [
    "video/mp4;codecs=avc1.42E01F,opus",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
  const MAX_VIDEO_SECONDS = 60;

  // Maps a pointer position onto the story canvas, which is letterboxed by
  // object-fit.
  function storyPoint(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(
      rect.width / STORY.width,
      rect.height / STORY.height,
    );
    return {
      x:
        (event.clientX - rect.left - (rect.width - STORY.width * scale) / 2) /
        scale,
      y:
        (event.clientY - rect.top - (rect.height - STORY.height * scale) / 2) /
        scale,
    };
  }

  // Mirrors how a file input's accept attribute filters the picker.
  function accepts(input, file) {
    const tokens = input.accept
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();
    return (
      tokens.length === 0 ||
      tokens.some((token) =>
        token.startsWith(".")
          ? name.endsWith(token)
          : token.endsWith("/*")
            ? type.startsWith(token.slice(0, -1))
            : type === token,
      )
    );
  }

  function attach(input, file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  let discardHost;

  // Instagram's mobile web composer offers no way out other than sharing, so
  // add one that returns to the feed. It goes away once Instagram navigates
  // home itself, as it does after sharing.
  function showDiscard(closeFriends) {
    discardHost?.remove();
    const host = element("div");
    const root = host.attachShadow({ mode: "closed" });
    root.adoptedStyleSheets = [styles];
    const floating = element("div", { className: "floating" });
    floating.append(
      confirmingButton("Discard", "Confirm discard", () =>
        location.assign("/"),
      ),
    );
    if (closeFriends) {
      floating.append(
        element("span", { className: "badge", textContent: "Close friends" }),
      );
    }
    root.append(floating);
    document.documentElement.append(host);
    discardHost = host;

    const removeOnHome = (event) => {
      if (new URL(event.destination.url).pathname === "/") {
        host.remove();
        navigation.removeEventListener("navigate", removeOnHome);
      }
    };
    navigation.addEventListener("navigate", removeOnHome);
  }

  const SHARE_NOTICES = {
    "close-friends": "Shared to close friends.",
    public:
      "Instagram did not apply close friends, so this story went to everyone.",
    unknown:
      "Instagram did not confirm close friends. Check the story's ring before anyone sees it.",
    blocked: "Not shared: close friends could not be applied.",
    "blocked-facebook":
      "Not shared: sharing to Facebook could not be turned off.",
    shared: "Shared to your story.",
  };

  // audience.js reports how a close friends share went.
  const SUCCESS = new Set(["close-friends", "shared"]);
  window.addEventListener("ig-plus:shared", (event) => {
    const { status } = event.detail;
    const host = element("div");
    const root = host.attachShadow({ mode: "closed" });
    root.adoptedStyleSheets = [styles];
    const notice = element("div", {
      className: SUCCESS.has(status) ? "notice" : "notice warning",
      textContent: SHARE_NOTICES[status],
      onclick: () => host.remove(),
    });
    root.append(notice);
    document.documentElement.append(host);
    if (SUCCESS.has(status)) {
      setTimeout(() => host.remove(), 5000);
    }
  });

  // This script runs in the page's world and cannot reach the extension, so
  // bridge.js answers these requests: "googlePhoto" resolves to the picked
  // File or null, and "uiFont" to the bytes of Callie's Nunito.
  function askExtension(request) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const { data } = event;
        if (
          event.source !== window ||
          data?.type !== "ig-plus:answer" ||
          data.id !== id
        ) {
          return;
        }
        window.removeEventListener("message", onMessage);
        if (data.error) {
          reject(new Error(data.error));
        } else {
          resolve(data.result);
        }
      };
      window.addEventListener("message", onMessage);
      window.postMessage({ type: "ig-plus:ask", id, request }, location.origin);
    });
  }

  let fontLoaded = false;
  // Instagram's CSP may block fonts the page loads, but not ones built from
  // bytes. Without the font, the styles fall back to the system's.
  async function loadFont() {
    if (fontLoaded) {
      return;
    }
    fontLoaded = true;
    try {
      const font = new FontFace("Nunito", await askExtension("uiFont"), {
        weight: "200 1000",
      });
      document.fonts.add(await font.load());
    } catch (error) {
      console.warn("IG Plus could not load Nunito:", error);
    }
  }

  // Opens the camera for Instagram's story file input, or, from the feed's
  // "Add to story", the editor with that post before the input exists.
  async function showCamera(input, shortcode) {
    loadFont();
    const host = element("div");
    const root = host.attachShadow({ mode: "closed" });
    root.adoptedStyleSheets = [styles];

    const videoProperties = { autoplay: true, muted: true, playsInline: true };
    const backdrop = element("video", {
      ...videoProperties,
      className: "backdrop",
    });
    const video = element("video", { ...videoProperties, className: "main" });
    const review = element("canvas", { ...STORY, hidden: true });
    const stage = element("div", { className: "stage" });
    stage.append(
      backdrop,
      video,
      review,
      element("div", { className: "guide" }),
    );

    const message = element("div", {
      className: "message",
      textContent: "Starting camera...",
    });
    const fileInput = element("input", {
      type: "file",
      accept: "image/*,video/*",
      hidden: true,
    });

    const swatchList = element("div", { className: "swatches" });
    const swatchButtons = BACKGROUNDS.map((background) => {
      const swatch = element("button", { className: "swatch" });
      swatch.style.background = cssBackground(background);
      swatch.onclick = () => pickBackground(swatch, background);
      return swatch;
    });
    swatchList.append(...swatchButtons);
    const previous = element("button", {
      className: "arrow",
      ariaLabel: "Previous colors",
    });
    previous.append(icon("left"));
    const next = element("button", {
      className: "arrow",
      ariaLabel: "More colors",
    });
    next.append(icon("right"));
    const swatches = element("div", { className: "picker", hidden: true });
    swatches.append(previous, swatchList, next);

    const zoomInput = element("input", {
      type: "range",
      min: 0.5,
      max: 5,
      step: 0.01,
      value: 1,
    });
    const photoRow = element("div", { className: "row" });
    photoRow.append(element("span", { textContent: "Zoom" }), zoomInput);

    const toolButtons = {
      photo: element("button", { textContent: "Photo" }),
      text: element("button", { textContent: "Text" }),
      brush: element("button", { textContent: "Brush" }),
    };
    const toolRow = element("div", { className: "row tools" });
    toolRow.append(...Object.values(toolButtons));

    const brushSwatches = element("div", { className: "row" });
    const brushButtons = BRUSH_COLORS.map((color) => {
      const swatch = element("button", { className: "swatch small" });
      swatch.style.background = color;
      swatch.onclick = () => pickBrush(color);
      return swatch;
    });
    brushSwatches.append(...brushButtons);
    const brushSizeInput = element("input", {
      type: "range",
      min: 4,
      max: 60,
      value: 16,
    });
    const undo = element("button", { textContent: "Undo" });
    const clear = element("button", { textContent: "Clear" });
    const brushSizeRow = element("div", { className: "row" });
    brushSizeRow.append(
      element("span", { textContent: "Size" }),
      brushSizeInput,
      undo,
      clear,
    );

    const textInput = element("textarea", {
      rows: 2,
      placeholder: "Add text, then drag on the image to place it",
    });
    const sizeInput = element("input", {
      type: "range",
      min: 40,
      max: 180,
      value: 80,
    });
    const fontButton = element("button", { textContent: FONTS[0].name });
    const styleButton = element("button", { textContent: "Style" });
    const sizeRow = element("div", { className: "row" });
    sizeRow.append(
      element("span", { textContent: "Text" }),
      sizeInput,
      fontButton,
      styleButton,
    );
    const controls = element("div", { className: "controls", hidden: true });
    // Each tool shows only its own controls.
    const toolControls = {
      photo: [photoRow],
      text: [textInput, sizeRow],
      brush: [brushSwatches, brushSizeRow],
    };
    controls.append(
      toolRow,
      photoRow,
      textInput,
      sizeRow,
      brushSwatches,
      brushSizeRow,
    );

    const cancel = element("button", {
      className: "destructive",
      textContent: "Cancel",
    });
    const choose = element("button", { textContent: "Choose file" });
    const googlePhotos = element("button", { textContent: "Google Photos" });
    const sharePost = element("button", { textContent: "Share post" });
    const linkInput = element("input", {
      type: "text",
      placeholder: "Link to a post or reel",
    });
    const openLink = element("button", {
      className: "primary",
      textContent: "Open",
    });
    const linkRow = element("div", { className: "row link", hidden: true });
    linkRow.append(linkInput, openLink);
    const colors = element("button", { textContent: "Colors" });
    const framing = element("button", { textContent: "Crop" });
    const take = element("button", {
      className: "primary",
      textContent: "Take photo",
      disabled: true,
    });
    const cameraBar = element("div", { className: "bar" });
    cameraBar.append(
      cancel,
      choose,
      googlePhotos,
      sharePost,
      colors,
      framing,
      take,
    );

    const back = element("button");
    const done = element("button", {
      className: "primary",
      textContent: "Done",
    });
    const checkbox = (label, checked) => {
      const input = element("input", { type: "checkbox", checked });
      const box = element("span", { className: "box" });
      box.append(icon("check"));
      const toggle = element("label", { className: "check" });
      toggle.append(input, box, element("span", { textContent: label }));
      return { input, toggle };
    };
    // Sharing settings move to whichever bar is showing, since videos skip
    // the editor.
    const audience = checkbox("Close friends", false);
    // Instagram cross-posts to Facebook when the account is set to, and its
    // web composer cannot turn that off for one story.
    const facebook = checkbox("Facebook", true);
    // Close friends stories never go to Facebook.
    let facebookAvailable = true;
    const updateFacebook = () => {
      const allowed = facebookAvailable && !audience.input.checked;
      facebook.input.disabled = !allowed;
      facebook.input.checked = allowed;
    };
    const setFacebookAvailable = (available) => {
      facebookAvailable = available;
      updateFacebook();
    };
    audience.input.onchange = updateFacebook;
    const sharing = element("span", { className: "row" });
    sharing.append(audience.toggle, facebook.toggle);
    cameraBar.insertBefore(sharing, take);
    const reviewBar = element("div", { className: "bar", hidden: true });
    reviewBar.append(back, done);

    const overlay = element("div", { className: "overlay" });
    overlay.append(
      stage,
      message,
      linkRow,
      swatches,
      controls,
      cameraBar,
      reviewBar,
    );
    root.append(overlay, fileInput);
    document.documentElement.append(host);

    let stream;
    // Either { colors }, { image, zoom, x, y }, or { post, zoom, x, y }.
    let base;
    // Set while Done makes and hands off the story.
    let busy = false;
    let tool = "text";
    let lastPoint;
    const brush = { color: BRUSH_COLORS[0], size: 16 };
    const strokes = [];
    const text = {
      value: "",
      x: STORY.width / 2,
      y: STORY.height / 2,
      size: 80,
      style: 0,
      font: 0,
    };

    // A shared video's card shows its cover frame until it records.
    const draw = (frame) => {
      const context = review.getContext("2d");
      if (base.colors) {
        drawBackground(context, base.colors);
      } else if (base.post) {
        drawCard(context, base, frame ?? base.post.image);
      } else {
        drawPhoto(context, base);
      }
      drawStrokes(context, strokes);
      drawText(context, text);
    };
    // Input can arrive several times a frame, so draw at most once a frame.
    let frame = 0;
    const render = () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        draw();
      });
    };
    const flush = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
        draw();
      }
    };
    const showMessage = (value) => {
      message.textContent = value;
      message.hidden = !value;
    };
    // "camera" shows the live view; "photo" and "colors" are the editor.
    const setMode = (mode, backLabel = "Back") => {
      const editing = mode !== "camera";
      linkRow.hidden = true;
      backdrop.hidden = video.hidden = cameraBar.hidden = editing;
      review.hidden = controls.hidden = reviewBar.hidden = !editing;
      message.hidden = editing || !message.textContent;
      swatches.hidden = mode !== "colors";
      toolButtons.photo.hidden = mode !== "photo";
      back.textContent = backLabel;
      const bar = editing ? reviewBar : cameraBar;
      bar.insertBefore(sharing, bar.lastElementChild);
    };
    const setTool = (name) => {
      tool = name;
      for (const [key, button] of Object.entries(toolButtons)) {
        button.ariaPressed = String(key === name);
        for (const control of toolControls[key]) {
          control.hidden = key !== name;
        }
      }
    };
    const pickBrush = (color) => {
      brush.color = color;
      brushButtons.forEach((button, index) =>
        button.classList.toggle("selected", BRUSH_COLORS[index] === color),
      );
    };
    pickBrush(brush.color);
    const setZoom = (zoom) => {
      base.zoom = Math.min(
        Math.max(zoom, Number(zoomInput.min)),
        Number(zoomInput.max),
      );
      zoomInput.value = base.zoom;
      render();
    };
    const releasePost = () => {
      base?.post?.video?.then(URL.revokeObjectURL, () => {});
    };
    const editPhoto = (image, fill, backLabel) => {
      setFacebookAvailable(true);
      const fillZoom = fitScale(image, "cover") / fitScale(image, "contain");
      zoomInput.max = Math.max(5, fillZoom);
      toolButtons.photo.textContent = "Photo";
      releasePost();
      base = { image, backdrop: blurredBackdrop(image), zoom: 1, x: 0, y: 0 };
      strokes.length = 0;
      setZoom(fill ? fillZoom : 1);
      setTool("photo");
      setMode("photo", backLabel);
    };
    const editPost = (post) => {
      done.disabled = false;
      zoomInput.max = 1.2;
      toolButtons.photo.textContent = "Post";
      releasePost();
      base = {
        post,
        backdrop: blurredBackdrop(post.image),
        zoom: 1,
        x: 0,
        y: 0,
      };
      strokes.length = 0;
      setZoom(1);
      setTool("photo");
      setMode("photo", input ? "Back" : "Cancel");
      // Video stories skip Instagram's composer, which is what knows the
      // Facebook account to cross-post to.
      setFacebookAvailable(!post.video);
      if (post.video) {
        const seconds = Math.ceil(Math.min(post.duration, MAX_VIDEO_SECONDS));
        showMessage(
          `The video plays in the story, without going to Facebook. Done records it, which takes ${seconds} seconds.`,
        );
        message.hidden = false;
      }
    };
    const pickBackground = (swatch, background) => {
      swatchButtons.forEach((button) =>
        button.classList.toggle("selected", button === swatch),
      );
      releasePost();
      setFacebookAvailable(true);
      base = { colors: background };
      render();
    };
    const close = () => {
      stream?.getTracks().forEach((track) => track.stop());
      releasePost();
      host.remove();
    };
    // Resolves to whether Instagram took the file.
    const handOff = async (file) => {
      const reshare = base?.post
        ? { mediaId: base.post.mediaId, card: cardSticker(base) }
        : null;
      const closeFriends = audience.input.checked;
      const skipFacebook = !facebook.input.checked;
      const tellAudience = () =>
        window.dispatchEvent(
          new CustomEvent("ig-plus:handoff", {
            detail: { closeFriends, skipFacebook, reshare },
          }),
        );
      if (file.type.startsWith("video/") && base?.post) {
        showMessage("Uploading the video...");
        try {
          await postVideoStory(
            file,
            {
              ...STORY,
              durationMs: Math.round(
                Math.min(base.post.duration, MAX_VIDEO_SECONDS) * 1000,
              ),
            },
            tellAudience,
          );
        } catch (error) {
          showMessage(`Could not post: ${error.message}`);
          return false;
        }
        close();
        // audience.js reports close friends shares itself.
        if (!closeFriends) {
          window.dispatchEvent(
            new CustomEvent("ig-plus:shared", { detail: { status: "shared" } }),
          );
        }
        return true;
      }
      let target = input;
      if (!target) {
        showMessage("Opening Instagram's story composer...");
        try {
          target = await requestStoryInput();
        } catch (error) {
          showMessage(`Could not post: ${error.message}`);
          return false;
        }
      }
      if (!accepts(target, file)) {
        showMessage(
          `Instagram's web composer does not take ${file.type || file.name} for stories. It takes: ${target.accept}`,
        );
        return false;
      }
      close();
      attach(target, file);
      tellAudience();
      showDiscard(closeFriends);
      return true;
    };

    // Plays the shared video once into its card and records the story with
    // the video's sound.
    const recordVideo = async (audio) => {
      const type = RECORDING_TYPES.find((candidate) =>
        MediaRecorder.isTypeSupported(candidate),
      );
      showMessage("Downloading the video...");
      let url;
      try {
        url = await base.post.video;
      } catch (error) {
        audio.close();
        throw new Error(`the video did not download: ${error.message}`);
      }
      const source = element("video", {
        src: url,
        playsInline: true,
        className: "source",
      });
      const sound = audio.createMediaStreamDestination();
      audio.createMediaElementSource(source).connect(sound);
      const recorder = new MediaRecorder(
        new MediaStream([
          ...review.captureStream(30).getVideoTracks(),
          ...sound.stream.getAudioTracks(),
        ]),
        { mimeType: type, videoBitsPerSecond: 8_000_000 },
      );
      const chunks = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const stop = () => {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      };
      const limit = Math.min(base.post.duration || Infinity, MAX_VIDEO_SECONDS);
      // A timer rather than animation frames, which stall when the window is
      // covered.
      let timer;
      const paint = () => {
        draw(source);
        if (source.ended || source.currentTime >= limit) {
          stop();
          return;
        }
        showMessage(
          `Recording the video: ${Math.floor(source.currentTime)} of ${Math.ceil(limit)} seconds.`,
        );
      };
      return new Promise((resolve, reject) => {
        recorder.onstop = () => {
          clearInterval(timer);
          source.pause();
          source.remove();
          audio.close();
          const fileType = type.split(";")[0];
          const extension = fileType === "video/mp4" ? "mp4" : "webm";
          resolve(
            new File(chunks, `story-${Date.now()}.${extension}`, {
              type: fileType,
            }),
          );
        };
        source.onended = stop;
        source.onerror = () => reject(new Error("the video would not play"));
        // Chrome will not play a video outside the document.
        root.append(source);
        draw();
        recorder.start();
        source.play().then(() => {
          timer = setInterval(paint, 1000 / 30);
        }, reject);
      });
    };

    const openFile = async (file) => {
      if (!file.type.startsWith("image/")) {
        // Instagram shows a blank composer for files its input does not take.
        if (accepts(input, file)) {
          handOff(file);
        } else {
          showMessage(
            `Instagram's web composer does not take ${file.type || file.name} for stories. It takes: ${input.accept}`,
          );
        }
        return;
      }
      try {
        editPhoto(await createImageBitmap(file), false, "Back");
      } catch (error) {
        showMessage(`Could not open ${file.name}: ${error.message}`);
      }
    };

    cancel.onclick = close;
    choose.onclick = () => openPicker(fileInput);
    fileInput.onchange = () => {
      const [file] = fileInput.files;
      fileInput.value = "";
      if (file) {
        openFile(file);
      }
    };
    sharePost.onclick = () => {
      linkRow.hidden = !linkRow.hidden;
      if (!linkRow.hidden) {
        const last = sessionStorage.getItem("ig-plus:post");
        linkInput.value ||= last ? `https://www.instagram.com/p/${last}/` : "";
        linkInput.focus();
        linkInput.select();
      }
    };
    linkInput.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        openLink.click();
      }
    });
    const openPost = async (shortcode) => {
      openLink.disabled = true;
      showMessage("Loading the post...");
      try {
        const post = await loadPost(shortcode);
        if (host.isConnected) {
          showMessage("");
          editPost(post);
        }
      } catch (error) {
        showMessage(`Could not load the post: ${error.message}`);
      } finally {
        openLink.disabled = false;
      }
    };
    openLink.onclick = () => {
      const shortcode = shortcodeOf(linkInput.value);
      if (shortcode) {
        openPost(shortcode);
      } else {
        showMessage("That does not look like a link to a post or reel.");
      }
    };
    googlePhotos.onclick = async () => {
      googlePhotos.disabled = true;
      showMessage("Pick a photo in the Google Photos window");
      try {
        const file = await askExtension("googlePhoto");
        showMessage("");
        if (file && host.isConnected) {
          openFile(file);
        }
      } catch (error) {
        showMessage(`Google Photos failed: ${error.message}`);
      } finally {
        googlePhotos.disabled = false;
      }
    };
    framing.onclick = () => {
      const fill = stage.classList.toggle("fill");
      framing.textContent = fill ? "Whole" : "Crop";
    };
    colors.onclick = () => {
      const selected =
        swatchButtons.find((swatch) => swatch.classList.contains("selected")) ??
        swatchButtons[0];
      strokes.length = 0;
      pickBackground(selected, BACKGROUNDS[swatchButtons.indexOf(selected)]);
      setTool("text");
      setMode("colors");
    };
    take.onclick = () =>
      editPhoto(
        captureFrame(video),
        stage.classList.contains("fill"),
        "Retake",
      );
    back.onclick = () => (input ? setMode("camera") : close());
    const snapshot = () =>
      new Promise((resolve) =>
        review.toBlob(
          (blob) =>
            resolve(
              new File([blob], `story-${Date.now()}.jpg`, {
                type: "image/jpeg",
              }),
            ),
          "image/jpeg",
          0.92,
        ),
      );
    done.onclick = async () => {
      if (busy) {
        return;
      }
      flush();
      busy = done.disabled = back.disabled = controls.inert = true;
      try {
        // Sound needs an audio context made within the click.
        await handOff(
          await (base.post?.video
            ? recordVideo(new AudioContext())
            : snapshot()),
        );
      } catch (error) {
        showMessage(`Could not make the story: ${error.message}`);
      } finally {
        busy = done.disabled = back.disabled = controls.inert = false;
      }
    };

    const updateArrows = () => {
      previous.disabled = swatchList.scrollLeft <= 0;
      next.disabled =
        swatchList.scrollLeft + swatchList.clientWidth >=
        swatchList.scrollWidth - 1;
    };
    const scrollSwatches = (direction) =>
      swatchList.scrollBy({
        left: direction * swatchList.clientWidth * 0.8,
        behavior: "smooth",
      });
    previous.onclick = () => scrollSwatches(-1);
    next.onclick = () => scrollSwatches(1);
    swatchList.onscroll = updateArrows;
    new ResizeObserver(updateArrows).observe(swatchList);

    zoomInput.oninput = () => setZoom(Number(zoomInput.value));
    for (const [name, button] of Object.entries(toolButtons)) {
      button.onclick = () => setTool(name);
    }
    brushSizeInput.oninput = () => {
      brush.size = Number(brushSizeInput.value);
    };
    undo.onclick = () => {
      strokes.pop();
      render();
    };
    clear.onclick = () => {
      strokes.length = 0;
      render();
    };

    // Keep Instagram's keyboard shortcuts from reacting to typing.
    textInput.addEventListener("keydown", (event) => event.stopPropagation());
    textInput.oninput = () => {
      text.value = textInput.value;
      render();
    };
    sizeInput.oninput = () => {
      text.size = Number(sizeInput.value);
      render();
    };
    fontButton.onclick = () => {
      text.font = (text.font + 1) % FONTS.length;
      fontButton.textContent = FONTS[text.font].name;
      render();
    };
    styleButton.onclick = () => {
      text.style = (text.style + 1) % TEXT_STYLES.length;
      render();
    };

    const drag = (point) => {
      if (tool === "brush") {
        strokes.at(-1).points.push(point);
      } else if (tool === "photo" && (base.image || base.post)) {
        base.x += point.x - lastPoint.x;
        base.y += point.y - lastPoint.y;
      } else {
        Object.assign(text, point);
      }
      lastPoint = point;
      render();
    };
    review.addEventListener("pointerdown", (event) => {
      review.setPointerCapture(event.pointerId);
      lastPoint = storyPoint(review, event);
      if (tool === "brush") {
        strokes.push({ ...brush, points: [] });
      }
      drag(lastPoint);
    });
    review.addEventListener("pointermove", (event) => {
      if (review.hasPointerCapture(event.pointerId)) {
        drag(storyPoint(review, event));
      }
    });
    review.addEventListener(
      "wheel",
      (event) => {
        if (base.image || base.post) {
          event.preventDefault();
          setZoom(base.zoom * Math.exp(-event.deltaY * 0.002));
        }
      },
      { passive: false },
    );

    if (!input) {
      setMode("photo", "Cancel");
      // editPost shows the canvas once the post loads.
      review.hidden = controls.hidden = true;
      done.disabled = true;
      openPost(shortcode);
      message.hidden = false;
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch (error) {
      showMessage(`Camera unavailable: ${error.message}`);
      return;
    }
    if (!host.isConnected) {
      close();
      return;
    }
    video.srcObject = stream;
    backdrop.srcObject = stream;
    showMessage("");
    take.disabled = false;
  }

  // Instagram renders the feed as it scrolls, so look again whenever it
  // changes the page, at most once a frame.
  let queued = false;
  new MutationObserver(() => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        addStoryButtons();
      });
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
