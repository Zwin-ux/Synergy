(function () {
  if (globalThis.__aiScriptDetectorContentLoaded) {
    return;
  }

  globalThis.__aiScriptDetectorContentLoaded = true;

  const App = globalThis.AIScriptDetector || {};
  const Text = App.text;
  const Dom = App.dom;

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
      case "extract:youtube-transcript":
        return extractYouTubeTranscriptPayload();
      case "extract:panel-input":
        return extractPanelInput(message.request || {});
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
        title: getDisplayTitle(),
        sourceType: "selection",
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

    return {
      ok: true,
      text,
      meta: {
        title: getDisplayTitle(),
        sourceType: "page",
        includedSources: ["page"],
        ...payload.metadata
      }
    };
  }

  async function buildPageContextPayload() {
    const selectionText = Text.sanitizeInput(getSelectionText());
    const pagePayload = Dom.extractVisibleDocumentPayload(document);
    const video = isYouTubeVideoPage() ? await getYouTubeVideoContext() : null;

    return {
      ok: true,
      context: {
        supported: true,
        title: getDisplayTitle(),
        hostname: location.hostname,
        selectionAvailable: Boolean(selectionText),
        pageAvailable: pagePayload.metadata.extractedWordCount >= 30,
        pageWordCount: pagePayload.metadata.extractedWordCount,
        pageMeta: pagePayload.metadata,
        isYouTubeVideo: Boolean(video),
        transcriptAvailable: Boolean(video?.transcriptAvailable),
        transcriptSourceLabel: video?.defaultTrackLabel || "",
        video
      }
    };
  }

  async function extractYouTubeTranscriptPayload() {
    if (!isYouTubeVideoPage()) {
      return {
        ok: false,
        error: "Open a YouTube watch page or Shorts page to capture a transcript."
      };
    }

    const transcriptResult = await getTranscriptResult({});
    if (!transcriptResult.text) {
      return {
        ok: false,
        error: "No transcript or captions were found for this YouTube video."
      };
    }

    return {
      ok: true,
      text: transcriptResult.text,
      meta: {
        title: getDisplayTitle(),
        sourceType: "youtube",
        includedSources: ["transcript"],
        transcriptSource: transcriptResult.trackLabel,
        transcriptSegmentCount: transcriptResult.segmentCount,
        selectedTrack: transcriptResult.selectedTrack || null
      }
    };
  }

  async function extractPanelInput(request) {
    if (request.mode === "selection") {
      return extractSelectionPayload();
    }

    if (request.mode === "page") {
      return extractPagePayload();
    }

    if (request.mode === "youtube") {
      return extractYouTubeCompositePayload(request);
    }

    return {
      ok: false,
      error: "Unsupported analysis source."
    };
  }

  async function extractYouTubeCompositePayload(request) {
    if (!isYouTubeVideoPage()) {
      return {
        ok: false,
        error: "Open a YouTube watch page to use video-specific analysis."
      };
    }

    const includeSources = normalizeSourceList(request.includeSources);
    const pieces = [];
    const usedSources = [];
    let transcriptMeta = null;

    if (includeSources.includes("transcript")) {
      const transcriptResult = await getTranscriptResult(request);
      if (transcriptResult.text) {
        pieces.push(transcriptResult.text);
        usedSources.push("transcript");
        transcriptMeta = transcriptResult;
      }
    }

    if (includeSources.includes("description")) {
      const description = getYouTubeDescriptionText();
      if (description) {
        pieces.push(description);
        usedSources.push("description");
      }
    }

    if (includeSources.includes("title")) {
      const title = getDisplayTitle();
      if (title) {
        pieces.push(title);
        usedSources.push("title");
      }
    }

    const text = Text.sanitizeInput(pieces.join("\n\n"));
    if (!text) {
      return {
        ok: false,
        error: "No usable video text could be extracted from the selected YouTube sources."
      };
    }

    return {
      ok: true,
      text,
      meta: {
        title: getDisplayTitle(),
        sourceType: "youtube",
        includedSources: usedSources,
        transcriptSource: transcriptMeta?.trackLabel || "",
        transcriptSegmentCount: transcriptMeta?.segmentCount || 0,
        selectedTrack: transcriptMeta?.selectedTrack || null
      }
    };
  }

  async function getYouTubeVideoContext() {
    const title = getDisplayTitle();
    const description = getYouTubeDescriptionText();
    const visibleLines = getVisibleTranscriptLines();
    const tracks = await getYouTubeCaptionTracks();
    const preferredTrack = selectPreferredTrack(tracks, {});

    return {
      title,
      description,
      descriptionAvailable: Boolean(description),
      descriptionLength: description.length,
      transcriptAvailable: visibleLines.length >= 4 || tracks.length > 0,
      transcriptTracks: tracks.map((track) => ({
        id: track.baseUrl,
        label: getTrackLabel(track),
        languageCode: track.languageCode || "",
        kind: track.kind || "manual",
        baseUrl: track.baseUrl
      })),
      defaultTrackBaseUrl: preferredTrack?.baseUrl || "",
      defaultTrackLabel:
        visibleLines.length >= 4 ? "Visible transcript" : preferredTrack ? getTrackLabel(preferredTrack) : "",
      availableSources: {
        transcript: visibleLines.length >= 4 || tracks.length > 0,
        description: Boolean(description),
        title: Boolean(title)
      }
    };
  }

  async function getTranscriptResult(request) {
    const visibleLines = getVisibleTranscriptLines();
    if (!request.trackBaseUrl && visibleLines.length >= 4) {
      return {
        text: Text.sanitizeInput(visibleLines.join("\n")),
        segmentCount: visibleLines.length,
        trackLabel: "Visible transcript",
        selectedTrack: {
          id: "visible-transcript",
          label: "Visible transcript",
          languageCode: "",
          kind: "visible",
          baseUrl: ""
        }
      };
    }

    const tracks = await getYouTubeCaptionTracks();
    if (!tracks.length) {
      return {
        text: "",
        segmentCount: 0,
        trackLabel: "",
        selectedTrack: null
      };
    }

    const track = selectPreferredTrack(tracks, request);
    if (!track) {
      return {
        text: "",
        segmentCount: 0,
        trackLabel: "",
        selectedTrack: null
      };
    }

    const transcript = await fetchCaptionTrack(track.baseUrl);
    return {
      text: transcript.text,
      segmentCount: transcript.segmentCount,
      trackLabel: getTrackLabel(track),
      selectedTrack: {
        id: track.baseUrl,
        label: getTrackLabel(track),
        languageCode: track.languageCode || "",
        kind: track.kind || "manual",
        baseUrl: track.baseUrl
      }
    };
  }

  function getVisibleTranscriptLines() {
    const segments = Array.from(document.querySelectorAll("ytd-transcript-segment-renderer"));
    if (!segments.length) {
      return [];
    }

    return segments
      .map((segment) => {
        const textElement =
          segment.querySelector(".segment-text") ||
          segment.querySelector("[class*='segment-text']") ||
          segment.querySelector("yt-formatted-string");
        return Text.sanitizeInput(textElement?.textContent || "");
      })
      .filter(Boolean);
  }

  async function getYouTubeCaptionTracks() {
    const snapshot = await readYouTubeCaptionSnapshot();
    return Array.isArray(snapshot?.captionTracks) ? snapshot.captionTracks : [];
  }

  function selectPreferredTrack(tracks, request) {
    const normalized = tracks.map((track) => ({
      ...track,
      languageCode: String(track.languageCode || "").toLowerCase()
    }));

    if (request.trackBaseUrl) {
      const directMatch = normalized.find((track) => track.baseUrl === request.trackBaseUrl);
      if (directMatch) {
        return directMatch;
      }
    }

    const preference = request.transcriptBias || "manual-en";
    const manualEnglish =
      normalized.find((track) => track.languageCode === "en" && track.kind !== "asr") ||
      normalized.find((track) => track.languageCode.startsWith("en-") && track.kind !== "asr");
    const autoEnglish =
      normalized.find((track) => track.languageCode === "en") ||
      normalized.find((track) => track.languageCode.startsWith("en-"));
    const firstManual = normalized.find((track) => track.kind !== "asr");

    if (preference === "manual-en") {
      return manualEnglish || autoEnglish || firstManual || normalized[0];
    }
    if (preference === "auto-en") {
      return autoEnglish || manualEnglish || firstManual || normalized[0];
    }
    if (preference === "manual-any") {
      return firstManual || autoEnglish || normalized[0];
    }
    if (preference === "auto-any") {
      return normalized.find((track) => track.kind === "asr") || autoEnglish || firstManual || normalized[0];
    }

    return autoEnglish || manualEnglish || firstManual || normalized[0];
  }

  async function fetchCaptionTrack(baseUrl) {
    const response = await fetch(baseUrl, {
      credentials: "include"
    });
    if (!response.ok) {
      throw new Error("Caption fetch failed.");
    }

    const xmlText = await response.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "text/xml");
    const segments = Array.from(xml.querySelectorAll("text"))
      .map((node) => Text.sanitizeInput(node.textContent || ""))
      .filter(Boolean);

    return {
      text: Text.sanitizeInput(segments.join("\n")),
      segmentCount: segments.length
    };
  }

  async function readYouTubeCaptionSnapshot() {
    const attributeName = `data-scriptlens-captions-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    const eventName = `scriptlens-captions-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;

    return new Promise((resolve) => {
      let finished = false;

      const complete = () => {
        if (finished) {
          return;
        }

        finished = true;
        window.removeEventListener(eventName, complete);
        const rawValue = document.documentElement.getAttribute(attributeName);
        document.documentElement.removeAttribute(attributeName);

        if (!rawValue) {
          resolve(null);
          return;
        }

        try {
          resolve(JSON.parse(rawValue));
        } catch (error) {
          resolve(null);
        }
      };

      window.addEventListener(eventName, complete, { once: true });

      const script = document.createElement("script");
      script.textContent = `
        (() => {
          const captionTracks =
            window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null;
          document.documentElement.setAttribute(
            ${JSON.stringify(attributeName)},
            JSON.stringify({ captionTracks })
          );
          window.dispatchEvent(new Event(${JSON.stringify(eventName)}));
        })();
      `;

      (document.documentElement || document.head || document.body).appendChild(script);
      script.remove();

      setTimeout(complete, 350);
    });
  }

  function getTrackLabel(track) {
    const name =
      track?.name?.simpleText ||
      (Array.isArray(track?.name?.runs)
        ? track.name.runs.map((part) => part.text).join("")
        : "");

    if (track?.kind === "asr") {
      return name ? `${name} auto captions` : "Auto captions";
    }

    return name ? `${name} captions` : "Video captions";
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

  function getDisplayTitle() {
    const title =
      document.querySelector("h1.ytd-watch-metadata")?.textContent ||
      document.querySelector("meta[property='og:title']")?.getAttribute("content") ||
      document.title ||
      "";

    return Text.sanitizeInput(title).replace(/\s+-\s+YouTube$/i, "");
  }

  function isYouTubeVideoPage() {
    const host = normalizeHost(location.hostname);
    return (
      (host === "youtube.com" || host === "m.youtube.com") &&
      (location.pathname === "/watch" || location.pathname.startsWith("/shorts/"))
    );
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

  function normalizeSourceList(value) {
    const allowed = new Set(["transcript", "description", "title"]);
    const list = Array.isArray(value) ? value : [];
    const normalized = list.filter((item) => allowed.has(item));
    return normalized.length ? normalized : ["transcript"];
  }

  function normalizeHost(hostname) {
    return String(hostname || "").replace(/^www\./, "");
  }
})();
