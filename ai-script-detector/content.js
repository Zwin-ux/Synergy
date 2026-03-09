(function () {
  if (globalThis.__aiScriptDetectorContentLoaded) {
    return;
  }

  globalThis.__aiScriptDetectorContentLoaded = true;

  const App = globalThis.AIScriptDetector || {};
  const Text = App.text;
  const Dom = App.dom;

  const BOOTSTRAP_ATTRIBUTE = "data-scriptlens-youtube-bootstrap";
  const BOOTSTRAP_REQUEST_EVENT = "scriptlens:request-youtube-bootstrap";
  const BOOTSTRAP_READY_EVENT = "scriptlens:youtube-bootstrap-ready";

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message)
      .then((response) => sendResponse(response))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "Page text extraction failed."
        })
      );

    return true;
  });

  async function handleMessage(message) {
    switch (message?.type) {
      case "extract:selection":
        return extractSelectionPayload();
      case "extract:page":
        return extractPagePayload();
      case "youtube:page-adapter":
        return {
          ok: true,
          adapter: await buildYouTubePageAdapter()
        };
      case "youtube:open-transcript-panel":
        return {
          ok: true,
          adapter: await openYouTubeTranscriptPanel()
        };
      case "page:context":
        return buildPageContextPayload();
      default:
        return {
          ok: false,
          error: "Unsupported page action."
        };
    }
  }

  function extractSelectionPayload() {
    const text = Text.sanitizeInput(getSelectionText());
    if (!text) {
      return {
        ok: false,
        error: "No live text selection found on the page."
      };
    }

    return {
      ok: true,
      text,
      meta: {
        sourceType: "selection",
        sourceLabel: "Selection",
        title: getDisplayTitle(),
        includedSources: ["selection"]
      }
    };
  }

  function extractPagePayload() {
    const payload = Dom.extractVisibleDocumentPayload(document);
    const text = Text.sanitizeInput(payload.text);
    if (!text) {
      return {
        ok: false,
        error: "No visible page text could be extracted."
      };
    }

    const contentKind = payload.metadata?.contentKind || "page-content";

    return {
      ok: true,
      text,
      meta: {
        sourceType: contentKind,
        sourceLabel:
          contentKind === "article-content" ? "Article content" : "Visible page content",
        title: getDisplayTitle(),
        includedSources: [contentKind],
        ...payload.metadata
      }
    };
  }

  async function buildPageContextPayload() {
    const pagePayload = Dom.extractVisibleDocumentPayload(document);
    const adapter = isYouTubeVideoPage() ? await buildYouTubePageAdapter() : null;
    const video = adapter ? buildVideoContextFromAdapter(adapter) : null;

    return {
      ok: true,
      context: {
        supported: true,
        title: getDisplayTitle(),
        hostname: location.hostname,
        selectionAvailable: Boolean(Text.sanitizeInput(getSelectionText())),
        pageAvailable: pagePayload.metadata.extractedWordCount >= 30,
        pageWordCount: pagePayload.metadata.extractedWordCount,
        pageKind: pagePayload.metadata.contentKind || "page-content",
        pageMeta: pagePayload.metadata,
        isYouTubeVideo: Boolean(adapter),
        transcriptAvailable: Boolean(video?.availableSources?.transcript),
        transcriptSourceLabel: video?.defaultTrackLabel || "",
        video
      }
    };
  }

  async function buildYouTubePageAdapter() {
    if (!isYouTubeVideoPage()) {
      return null;
    }

    const bootstrapSnapshot = (await requestBootstrapSnapshot()) || {};
    const description = getYouTubeDescriptionText();
    const domTranscriptSegments = getVisibleTranscriptSegments();
    const descriptionTranscriptText = getDescriptionTranscriptText(description);
    const videoDurationSeconds =
      bootstrapSnapshot.videoDurationSeconds || getVideoDurationSecondsFromDom();

    return {
      title: getDisplayTitle(),
      description,
      descriptionTranscriptText,
      domTranscriptSegments,
      domTranscriptLanguageCode: bootstrapSnapshot.hl || null,
      requestShapeValidation: buildRequestShapeValidation(bootstrapSnapshot),
      bootstrapSnapshot,
      videoDurationSeconds,
      url: location.href,
      videoId: bootstrapSnapshot.videoId || new URLSearchParams(location.search).get("v") || ""
    };
  }

  function buildVideoContextFromAdapter(adapter) {
    const tracks = Array.isArray(adapter.bootstrapSnapshot?.captionTracks)
      ? adapter.bootstrapSnapshot.captionTracks
      : [];
    const transcriptTracks = tracks.map((track) => ({
      id: track.baseUrl,
      label: getCaptionTrackLabel(track),
      languageCode: track.languageCode || "",
      kind: track.kind || "manual",
      baseUrl: track.baseUrl
    }));

    if (adapter.domTranscriptSegments.length) {
      transcriptTracks.push({
        id: "visible-dom-transcript",
        label: "Visible transcript",
        languageCode: adapter.domTranscriptLanguageCode || "",
        kind: "visible",
        baseUrl: "visible-dom-transcript"
      });
    }

    if (adapter.descriptionTranscriptText) {
      transcriptTracks.push({
        id: "description-transcript",
        label: "Description transcript",
        languageCode: adapter.bootstrapSnapshot?.hl || "",
        kind: "description-transcript",
        baseUrl: "description-transcript"
      });
    }

    const defaultCaptionTrack = pickDefaultCaptionTrack(transcriptTracks);

    return {
      title: adapter.title,
      description: adapter.description,
      descriptionAvailable: Boolean(adapter.description),
      descriptionLength: adapter.description.length,
      transcriptAvailable:
        Boolean(adapter.bootstrapSnapshot?.transcriptParams) ||
        tracks.length > 0 ||
        adapter.domTranscriptSegments.length > 0 ||
        Boolean(adapter.descriptionTranscriptText),
      transcriptTracks,
      defaultTrackBaseUrl: defaultCaptionTrack?.baseUrl || "",
      defaultTrackLabel: defaultCaptionTrack?.label || "",
      availableSources: {
        transcript:
          Boolean(adapter.bootstrapSnapshot?.transcriptParams) ||
          tracks.length > 0 ||
          adapter.domTranscriptSegments.length > 0 ||
          Boolean(adapter.descriptionTranscriptText),
        description: Boolean(adapter.description),
        title: Boolean(adapter.title)
      }
    };
  }

  async function requestBootstrapSnapshot() {
    return new Promise((resolve) => {
      let finished = false;

      const complete = () => {
        if (finished) {
          return;
        }
        finished = true;
        window.removeEventListener(BOOTSTRAP_READY_EVENT, complete);
        resolve(readBootstrapAttribute());
      };

      window.addEventListener(BOOTSTRAP_READY_EVENT, complete, { once: true });
      document.dispatchEvent(new CustomEvent(BOOTSTRAP_REQUEST_EVENT));
      window.setTimeout(complete, 160);
    });
  }

  function readBootstrapAttribute() {
    const rawValue = document.documentElement?.getAttribute(BOOTSTRAP_ATTRIBUTE) || "";
    if (!rawValue) {
      return null;
    }

    try {
      return JSON.parse(rawValue);
    } catch (error) {
      return null;
    }
  }

  function getVisibleTranscriptSegments() {
    return Array.from(document.querySelectorAll("ytd-transcript-segment-renderer"))
      .map((segment, index) => {
        const textElement =
          segment.querySelector(".segment-text") ||
          segment.querySelector("[class*='segment-text']") ||
          segment.querySelector("yt-formatted-string");
        const timeElement =
          segment.querySelector(".segment-timestamp") ||
          segment.querySelector("[class*='segment-timestamp']") ||
          segment.querySelector("#segment-timestamp");
        const text = Text.sanitizeInput(textElement?.textContent || "");
        if (!text) {
          return null;
        }

        const startMs = parseDisplayedTime(timeElement?.textContent || "");
        return {
          startMs,
          durationMs: null,
          text,
          index
        };
      })
      .filter(Boolean);
  }

  async function openYouTubeTranscriptPanel() {
    if (!isYouTubeVideoPage()) {
      return null;
    }

    if (getVisibleTranscriptSegments().length) {
      return buildYouTubePageAdapter();
    }

    const opened = await ensureTranscriptPanelVisible();
    const adapter = await buildYouTubePageAdapter();

    if (!opened && !adapter?.domTranscriptSegments?.length) {
      return {
        ...(adapter || {}),
        requestShapeValidation: buildRequestShapeValidation(adapter?.bootstrapSnapshot || {})
      };
    }

    return adapter;
  }

  function getYouTubeDescriptionText() {
    const selectors = [
      "ytd-watch-metadata #description-inline-expander",
      "ytd-watch-metadata #description",
      "#bottom-row #description",
      "meta[property='og:description']",
      "meta[name='description']"
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element) {
        continue;
      }

      const value =
        element.tagName === "META"
          ? element.getAttribute("content") || ""
          : element.textContent || "";
      const text = Text.sanitizeInput(value);
      if (text) {
        return text;
      }
    }

    return "";
  }

  function getDescriptionTranscriptText(descriptionText) {
    const source = Text.sanitizeInput(descriptionText || "");
    if (!source) {
      return "";
    }

    const match = source.match(/(?:^|\n)(?:full\s+)?transcript\s*:?\s*\n+/i);
    if (!match || typeof match.index !== "number") {
      return "";
    }

    const candidate = Text.sanitizeInput(source.slice(match.index + match[0].length));
    return Text.countWords(candidate) >= 80 ? candidate : "";
  }

  function getDisplayTitle() {
    const title =
      document.querySelector("h1.ytd-watch-metadata")?.textContent ||
      document.querySelector("meta[property='og:title']")?.getAttribute("content") ||
      document.title ||
      "";

    return Text.sanitizeInput(title).replace(/\s+-\s+YouTube$/i, "");
  }

  function getSelectionText() {
    const selection = globalThis.getSelection?.();
    const selectionText = selection ? String(selection).trim() : "";
    if (selectionText) {
      return selectionText;
    }

    const active = document.activeElement;
    if (!active) {
      return "";
    }

    const isTextField =
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLInputElement &&
        /^(text|search|email|url|tel)$/i.test(active.type || ""));

    if (!isTextField) {
      return "";
    }

    const start = active.selectionStart || 0;
    const end = active.selectionEnd || 0;
    if (end <= start) {
      return "";
    }

    return active.value.slice(start, end);
  }

  function getCaptionTrackLabel(track) {
    const name =
      track?.name?.simpleText ||
      (Array.isArray(track?.name?.runs)
        ? track.name.runs.map((part) => part.text).join("")
        : "");

    if (track?.kind === "asr") {
      return name ? `${name} auto captions` : "Auto captions";
    }
    return name ? `${name} captions` : "Caption track";
  }

  function pickDefaultCaptionTrack(tracks) {
    const list = Array.isArray(tracks) ? tracks.slice() : [];
    const manualCaption = list.find(
      (track) =>
        track.kind !== "asr" &&
        track.kind !== "visible" &&
        track.kind !== "description-transcript"
    );
    const generatedCaption = list.find((track) => track.kind === "asr");
    const visibleTrack = list.find((track) => track.kind === "visible");
    const descriptionTrack = list.find((track) => track.kind === "description-transcript");
    return manualCaption || generatedCaption || visibleTrack || descriptionTrack || list[0] || null;
  }

  function getVideoDurationSecondsFromDom() {
    const durationText =
      document.querySelector(".ytp-time-duration")?.textContent ||
      document.querySelector("meta[itemprop='duration']")?.getAttribute("content") ||
      "";

    if (/^PT/i.test(durationText)) {
      return parseIsoDuration(durationText);
    }

    const startMs = parseDisplayedTime(durationText);
    return startMs !== null ? startMs / 1000 : null;
  }

  function parseDisplayedTime(value) {
    const parts = String(value || "")
      .trim()
      .split(":")
      .map((part) => Number(part));

    if (!parts.length || parts.some((part) => !Number.isFinite(part))) {
      return null;
    }

    let seconds = 0;
    while (parts.length) {
      seconds = seconds * 60 + parts.shift();
    }
    return seconds * 1000;
  }

  function parseIsoDuration(value) {
    const match = String(value || "").match(
      /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i
    );
    if (!match) {
      return null;
    }

    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    return hours * 3600 + minutes * 60 + seconds;
  }

  function isYouTubeVideoPage() {
    const host = String(location.hostname || "").replace(/^www\./, "");
    return host === "youtube.com" && location.pathname === "/watch";
  }

  async function ensureTranscriptPanelVisible() {
    if (getVisibleTranscriptSegments().length) {
      return true;
    }

    await expandDescriptionSection();

    const directTrigger = findTranscriptTrigger();
    if (directTrigger) {
      clickElement(directTrigger);
      if (await waitForTranscriptSegments(1200)) {
        return true;
      }
    }

    const moreActionsButton = findMoreActionsButton();
    if (moreActionsButton) {
      clickElement(moreActionsButton);
      await delay(220);

      const menuTrigger = findTranscriptMenuItem();
      if (menuTrigger) {
        clickElement(menuTrigger);
        if (await waitForTranscriptSegments(1400)) {
          return true;
        }
      }
    }

    return getVisibleTranscriptSegments().length > 0;
  }

  async function waitForTranscriptSegments(timeoutMs) {
    const deadlineAt = Date.now() + timeoutMs;
    while (Date.now() < deadlineAt) {
      if (getVisibleTranscriptSegments().length) {
        return true;
      }
      await delay(120);
    }
    return getVisibleTranscriptSegments().length > 0;
  }

  function findTranscriptTrigger() {
    const selectorMatches = [
      "button[aria-label*='transcript' i]",
      "button[title*='transcript' i]",
      "ytd-video-description-transcript-section-renderer button"
    ];

    for (const selector of selectorMatches) {
      const element = document.querySelector(selector);
      if (isElementVisible(element)) {
        return resolveClickableElement(element);
      }
    }

    return findVisibleElementByText(
      [
        "button",
        "ytd-button-renderer",
        "tp-yt-paper-button",
        "yt-formatted-string"
      ],
      "transcript"
    );
  }

  function findMoreActionsButton() {
    const selectors = [
      "ytd-menu-renderer button[aria-label*='more' i]",
      "button[aria-label*='more actions' i]",
      "button[aria-label='Action menu']",
      "button[aria-haspopup='true'][aria-label]"
    ];

    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector));
      const element = candidates.find(isElementVisible);
      if (element) {
        return resolveClickableElement(element);
      }
    }

    return null;
  }

  function findTranscriptMenuItem() {
    return findVisibleElementByText(
      [
        "ytd-menu-service-item-renderer",
        "tp-yt-paper-item",
        "yt-formatted-string",
        "button"
      ],
      "transcript"
    );
  }

  function findVisibleElementByText(selectors, textNeedle) {
    const needle = String(textNeedle || "").trim().toLowerCase();
    if (!needle) {
      return null;
    }

    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll(selector));
      const match = elements.find((element) => {
        const text = Text.sanitizeInput(element?.textContent || "").toLowerCase();
        return text.includes(needle) && isElementVisible(element);
      });
      if (match) {
        return resolveClickableElement(match);
      }
    }

    return null;
  }

  async function expandDescriptionSection() {
    const candidates = [
      "tp-yt-paper-button#expand-sizer",
      "ytd-watch-metadata tp-yt-paper-button#expand",
      "ytd-watch-metadata ytd-text-inline-expander tp-yt-paper-button",
      "ytd-watch-metadata button[aria-label*='more' i]",
      "#description-inline-expander tp-yt-paper-button#expand",
      "#description-inline-expander tp-yt-paper-button",
      "#description-inline-expander button[aria-label*='more' i]",
      "tp-yt-paper-button"
    ];

    for (const selector of candidates) {
      const elements = Array.from(document.querySelectorAll(selector));
      const target = elements.find((element) => {
        const text = Text.sanitizeInput(element?.textContent || "").toLowerCase();
        return Boolean(text.includes("more") || text.includes("expand"));
      });

      if (!target) {
        continue;
      }

      clickElement(target);
      await delay(220);
      return true;
    }

    return false;
  }

  function resolveClickableElement(element) {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    return (
      element.closest(
        [
          "button",
          "tp-yt-paper-button",
          "ytd-button-renderer",
          "ytd-menu-service-item-renderer",
          "tp-yt-paper-item"
        ].join(",")
      ) || element
    );
  }

  function isElementVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  }

  function clickElement(element) {
    const target = resolveClickableElement(element);
    if (!target) {
      return;
    }
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    target.click();
  }

  function buildRequestShapeValidation(bootstrapSnapshot) {
    const observed = bootstrapSnapshot?.observedTranscriptRequest || null;
    if (!observed) {
      return null;
    }

    const mismatchedFields = [];
    if ((observed.params || "") !== (bootstrapSnapshot?.transcriptParams || "")) {
      mismatchedFields.push("params");
    }

    return {
      matches: mismatchedFields.length === 0,
      reconstructedParams: bootstrapSnapshot?.transcriptParams || null,
      observedParams: observed.params || null,
      mismatchedFields,
      validatedAt: observed.observedAt || Date.now()
    };
  }

  function delay(timeoutMs) {
    return new Promise((resolve) => window.setTimeout(resolve, timeoutMs));
  }
})();
