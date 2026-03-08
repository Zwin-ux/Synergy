(function () {
  if (globalThis.__aiScriptDetectorContentLoaded) {
    return;
  }

  globalThis.__aiScriptDetectorContentLoaded = true;

  const App = globalThis.AIScriptDetector || {};
  const Text = App.text;
  const Dom = App.dom;
  const VISIBLE_TRANSCRIPT_TRACK_ID = "visible-transcript";
  const DESCRIPTION_TRANSCRIPT_TRACK_ID = "description-transcript";

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
    const description = getYouTubeDescriptionText();
    const title = getDisplayTitle();
    const pieces = [];
    const usedSources = [];
    let transcriptMeta = null;
    let fallbackApplied = false;

    if (includeSources.includes("transcript")) {
      const transcriptResult = await getTranscriptResult(request);
      if (transcriptResult.text) {
        pieces.push(transcriptResult.text);
        usedSources.push("transcript");
        transcriptMeta = transcriptResult;
      }
    }

    if (includeSources.includes("description")) {
      if (description && transcriptMeta?.sourceOrigin !== "description") {
        pieces.push(description);
        usedSources.push("description");
      }
    }

    if (includeSources.includes("title")) {
      if (title) {
        pieces.push(title);
        usedSources.push("title");
      }
    }

    if (
      includeSources.includes("transcript") &&
      !usedSources.includes("transcript")
    ) {
      if (description && transcriptMeta?.sourceOrigin !== "description" && !usedSources.includes("description")) {
        pieces.push(description);
        usedSources.push("description");
        fallbackApplied = true;
      }
      if (title && !usedSources.includes("title")) {
        pieces.push(title);
        usedSources.push("title");
        fallbackApplied = true;
      }
    }

    const text = Text.sanitizeInput(pieces.join("\n\n"));
    if (!text) {
      const transcriptRequested = includeSources.includes("transcript");
      const fallbackHint =
        transcriptRequested && (getYouTubeDescriptionText() || getDisplayTitle())
          ? " Try enabling Description or Title as a fallback source."
          : "";

      return {
        ok: false,
        error: `No usable video text could be extracted from the selected YouTube sources.${fallbackHint}`
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
        selectedTrack: transcriptMeta?.selectedTrack || null,
        fallbackApplied,
        fallbackReason:
          fallbackApplied && includeSources.includes("transcript")
            ? "Transcript text was unavailable, so ScriptLens used the best local video context instead."
            : ""
      }
    };
  }

  async function getYouTubeVideoContext() {
    const title = getDisplayTitle();
    const description = getYouTubeDescriptionText();
    const descriptionTranscript = getDescriptionTranscriptText(description);
    const visibleLines = getVisibleTranscriptLines();
    const tracks = await getYouTubeCaptionTracks();
    const preferredTrack = selectPreferredTrack(tracks, {});
    const transcriptTracks = [];

    if (visibleLines.length >= 4) {
      transcriptTracks.push({
        id: VISIBLE_TRANSCRIPT_TRACK_ID,
        label: "Visible transcript",
        languageCode: "",
        kind: "visible",
        baseUrl: VISIBLE_TRANSCRIPT_TRACK_ID
      });
    }

    if (descriptionTranscript) {
      transcriptTracks.push({
        id: DESCRIPTION_TRANSCRIPT_TRACK_ID,
        label: "Description transcript",
        languageCode: "",
        kind: "description-transcript",
        baseUrl: DESCRIPTION_TRANSCRIPT_TRACK_ID
      });
    }

    transcriptTracks.push(
      ...tracks.map((track) => ({
        id: track.baseUrl,
        label: getTrackLabel(track),
        languageCode: track.languageCode || "",
        kind: track.kind || "manual",
        baseUrl: track.baseUrl
      }))
    );

    return {
      title,
      description,
      descriptionAvailable: Boolean(description),
      descriptionLength: description.length,
      transcriptAvailable: visibleLines.length >= 4 || Boolean(descriptionTranscript) || tracks.length > 0,
      transcriptTracks,
      defaultTrackBaseUrl:
        visibleLines.length >= 4
          ? VISIBLE_TRANSCRIPT_TRACK_ID
          : descriptionTranscript
            ? DESCRIPTION_TRANSCRIPT_TRACK_ID
            : preferredTrack?.baseUrl || "",
      defaultTrackLabel:
        visibleLines.length >= 4
          ? "Visible transcript"
          : descriptionTranscript
            ? "Description transcript"
            : preferredTrack
              ? getTrackLabel(preferredTrack)
              : "",
      availableSources: {
        transcript: visibleLines.length >= 4 || Boolean(descriptionTranscript) || tracks.length > 0,
        description: Boolean(description),
        title: Boolean(title)
      }
    };
  }

  async function getTranscriptResult(request) {
    const visibleLines = getVisibleTranscriptLines();
    const descriptionTranscript = getDescriptionTranscriptText();
    if (
      visibleLines.length >= 4 &&
      (!request.trackBaseUrl || request.trackBaseUrl === VISIBLE_TRANSCRIPT_TRACK_ID)
    ) {
      return {
        text: Text.sanitizeInput(visibleLines.join("\n")),
        segmentCount: visibleLines.length,
        trackLabel: "Visible transcript",
        selectedTrack: {
          id: VISIBLE_TRANSCRIPT_TRACK_ID,
          label: "Visible transcript",
          languageCode: "",
          kind: "visible",
          baseUrl: VISIBLE_TRANSCRIPT_TRACK_ID
        }
      };
    }

    if (
      descriptionTranscript &&
      (!request.trackBaseUrl || request.trackBaseUrl === DESCRIPTION_TRANSCRIPT_TRACK_ID)
    ) {
      return {
        text: descriptionTranscript,
        segmentCount: Math.max(Text.splitParagraphs(descriptionTranscript).length, 1),
        trackLabel: "Description transcript",
        sourceOrigin: "description",
        selectedTrack: {
          id: DESCRIPTION_TRANSCRIPT_TRACK_ID,
          label: "Description transcript",
          languageCode: "",
          kind: "description-transcript",
          baseUrl: DESCRIPTION_TRANSCRIPT_TRACK_ID
        }
      };
    }

    const tracks = await getYouTubeCaptionTracks();
    if (!tracks.length) {
      if (descriptionTranscript) {
        return {
          text: descriptionTranscript,
          segmentCount: Math.max(Text.splitParagraphs(descriptionTranscript).length, 1),
          trackLabel: "Description transcript",
          sourceOrigin: "description",
          selectedTrack: {
            id: DESCRIPTION_TRANSCRIPT_TRACK_ID,
            label: "Description transcript",
            languageCode: "",
            kind: "description-transcript",
            baseUrl: DESCRIPTION_TRANSCRIPT_TRACK_ID
          }
        };
      }

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
    if (!transcript.text && visibleLines.length >= 4) {
      return {
        text: Text.sanitizeInput(visibleLines.join("\n")),
        segmentCount: visibleLines.length,
        trackLabel: "Visible transcript",
        selectedTrack: {
          id: VISIBLE_TRANSCRIPT_TRACK_ID,
          label: "Visible transcript",
          languageCode: "",
          kind: "visible",
          baseUrl: VISIBLE_TRANSCRIPT_TRACK_ID
        }
      };
    }

    if (!transcript.text && descriptionTranscript) {
      return {
        text: descriptionTranscript,
        segmentCount: Math.max(Text.splitParagraphs(descriptionTranscript).length, 1),
        trackLabel: "Description transcript",
        sourceOrigin: "description",
        selectedTrack: {
          id: DESCRIPTION_TRANSCRIPT_TRACK_ID,
          label: "Description transcript",
          languageCode: "",
          kind: "description-transcript",
          baseUrl: DESCRIPTION_TRANSCRIPT_TRACK_ID
        }
      };
    }

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
    const snapshot = await requestYouTubeCaptionSnapshot();
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

    const visibleTrack = normalized.find(
      (track) => track.kind === "visible" || track.baseUrl === VISIBLE_TRANSCRIPT_TRACK_ID
    );
    if (visibleTrack) {
      return visibleTrack;
    }

    const descriptionTrack = normalized.find(
      (track) =>
        track.kind === "description-transcript" ||
        track.baseUrl === DESCRIPTION_TRANSCRIPT_TRACK_ID
    );
    if (descriptionTrack) {
      return descriptionTrack;
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
    const attemptUrls = buildCaptionAttemptUrls(baseUrl);

    for (const attemptUrl of attemptUrls) {
      try {
        const response = await fetch(attemptUrl, {
          credentials: "include"
        });
        if (!response.ok) {
          continue;
        }

        const payloadText = await response.text();
        const parsedTranscript = parseCaptionPayload(payloadText);
        if (parsedTranscript.text) {
          return parsedTranscript;
        }
      } catch (error) {
        continue;
      }
    }

    return {
      text: "",
      segmentCount: 0
    };
  }

  function buildCaptionAttemptUrls(baseUrl) {
    const values = [];
    const seen = new Set();

    const pushUrl = (value) => {
      if (!value || seen.has(value)) {
        return;
      }
      seen.add(value);
      values.push(value);
    };

    pushUrl(baseUrl);

    try {
      const url = new URL(baseUrl);
      ["json3", "srv3", "vtt"].forEach((format) => {
        const nextUrl = new URL(url.toString());
        nextUrl.searchParams.set("fmt", format);
        pushUrl(nextUrl.toString());
      });
    } catch (error) {
      return values;
    }

    return values;
  }

  function parseCaptionPayload(payloadText) {
    const source = String(payloadText || "").trim();
    if (!source) {
      return {
        text: "",
        segmentCount: 0
      };
    }

    if (source.startsWith("{")) {
      return parseJsonCaptionPayload(source);
    }

    if (source.startsWith("WEBVTT")) {
      return parseVttCaptionPayload(source);
    }

    return parseXmlCaptionPayload(source);
  }

  function parseJsonCaptionPayload(source) {
    try {
      const parsed = JSON.parse(source);
      const segments = (parsed?.events || [])
        .map((event) => {
          const text = (event?.segs || [])
            .map((segment) => decodeCaptionText(segment?.utf8 || ""))
            .join("")
            .replace(/\s+/g, " ")
            .trim();
          return Text.sanitizeInput(text);
        })
        .filter(Boolean);

      return {
        text: Text.sanitizeInput(segments.join("\n")),
        segmentCount: segments.length
      };
    } catch (error) {
      return {
        text: "",
        segmentCount: 0
      };
    }
  }

  function parseXmlCaptionPayload(source) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(source, "text/xml");
    const candidateNodes = xml.querySelectorAll("text, p");
    const segments = Array.from(candidateNodes)
      .map((node) => Text.sanitizeInput(decodeCaptionText(node.textContent || "")))
      .filter(Boolean);

    return {
      text: Text.sanitizeInput(segments.join("\n")),
      segmentCount: segments.length
    };
  }

  function parseVttCaptionPayload(source) {
    const lines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) {
          return false;
        }

        if (
          line === "WEBVTT" ||
          /^\d+$/.test(line) ||
          /^(?:\d{2}:)?\d{2}:\d{2}\.\d{3}\s+-->\s+(?:\d{2}:)?\d{2}:\d{2}\.\d{3}/.test(line) ||
          /^(NOTE|STYLE|REGION)\b/.test(line)
        ) {
          return false;
        }

        return true;
      })
      .map((line) => Text.sanitizeInput(decodeCaptionText(line)));

    return {
      text: Text.sanitizeInput(lines.join("\n")),
      segmentCount: lines.length
    };
  }

  function decodeCaptionText(value) {
    const element = document.createElement("textarea");
    element.innerHTML = String(value || "");
    return element.value.replace(/\u00a0/g, " ");
  }

  async function requestYouTubeCaptionSnapshot() {
    const attributeName = "data-scriptlens-caption-snapshot";
    const requestEvent = "scriptlens:request-caption-snapshot";
    const readyEvent = "scriptlens:caption-snapshot-ready";

    return new Promise((resolve) => {
      let completed = false;

      const finish = () => {
        if (completed) {
          return;
        }

        completed = true;
        window.removeEventListener(readyEvent, finish);
        resolve(readCaptionSnapshotAttribute(attributeName));
      };

      window.addEventListener(readyEvent, finish, { once: true });
      document.dispatchEvent(new CustomEvent(requestEvent));
      window.setTimeout(finish, 180);
    });
  }

  function readCaptionSnapshotAttribute(attributeName) {
    const rawValue = document.documentElement?.getAttribute(attributeName) || "";
    if (!rawValue) {
      return null;
    }

    try {
      return JSON.parse(rawValue);
    } catch (error) {
      return null;
    }
  }

  function getTrackLabel(track) {
    if (track?.kind === "visible" || track?.baseUrl === VISIBLE_TRANSCRIPT_TRACK_ID) {
      return "Visible transcript";
    }
    if (
      track?.kind === "description-transcript" ||
      track?.baseUrl === DESCRIPTION_TRANSCRIPT_TRACK_ID
    ) {
      return "Description transcript";
    }

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

  function getDescriptionTranscriptText(descriptionText) {
    const source = Text.sanitizeInput(descriptionText || getYouTubeDescriptionText());
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
