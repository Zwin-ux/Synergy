(function (root) {
  if (root.__scriptLensYouTubeMainLoaded) {
    return;
  }

  root.__scriptLensYouTubeMainLoaded = true;

  const SNAPSHOT_ATTRIBUTE = "data-scriptlens-youtube-bootstrap";
  const REQUEST_EVENT = "scriptlens:request-youtube-bootstrap";
  const READY_EVENT = "scriptlens:youtube-bootstrap-ready";
  let refreshTimer = 0;

  init();

  function init() {
    installTranscriptRequestObserver();
    writeSnapshot();
    scheduleRefreshBurst();

    document.addEventListener(REQUEST_EVENT, writeSnapshot);
    root.addEventListener("yt-navigate-start", scheduleRefreshBurst);
    root.addEventListener("yt-navigate-finish", scheduleRefreshBurst);
    root.addEventListener("yt-page-data-updated", scheduleRefreshBurst);
    root.addEventListener("load", scheduleRefreshBurst);
  }

  function scheduleRefreshBurst() {
    clearTimeout(refreshTimer);
    writeSnapshot();

    [160, 650, 1600].forEach((delay) => {
      refreshTimer = root.setTimeout(writeSnapshot, delay);
    });
  }

  function writeSnapshot() {
    const target = document.documentElement;
    if (!target) {
      return;
    }

    try {
      target.setAttribute(SNAPSHOT_ATTRIBUTE, JSON.stringify(readBootstrapSnapshot()));
    } catch (error) {
      target.removeAttribute(SNAPSHOT_ATTRIBUTE);
    }

    root.dispatchEvent(new CustomEvent(READY_EVENT));
  }

  function readBootstrapSnapshot() {
    const playerResponse = readPlayerResponse();
    const initialData = root.ytInitialData || null;
    const ytcfgData = root.ytcfg?.data_ || {};
    const captionRenderer = playerResponse?.captions?.playerCaptionsTracklistRenderer || {};
    const clientContext =
      root.INNERTUBE_CONTEXT ||
      ytcfgData.INNERTUBE_CONTEXT ||
      buildClientContextFromConfig(ytcfgData);

    return {
      apiKey:
        root.INNERTUBE_API_KEY ||
        ytcfgData.INNERTUBE_API_KEY ||
        root.ytcfg?.get?.("INNERTUBE_API_KEY") ||
        "",
      clientContext: clientContext || null,
      visitorData:
        ytcfgData.VISITOR_DATA ||
        clientContext?.client?.visitorData ||
        root.ytcfg?.get?.("VISITOR_DATA") ||
        "",
      clientName:
        clientContext?.client?.clientName ||
        ytcfgData.INNERTUBE_CONTEXT_CLIENT_NAME ||
        root.INNERTUBE_CONTEXT_CLIENT_NAME ||
        "",
      clientVersion:
        clientContext?.client?.clientVersion ||
        ytcfgData.INNERTUBE_CONTEXT_CLIENT_VERSION ||
        root.INNERTUBE_CONTEXT_CLIENT_VERSION ||
        "",
      hl: clientContext?.client?.hl || ytcfgData.HL || "",
      gl: clientContext?.client?.gl || ytcfgData.GL || "",
      videoId:
        playerResponse?.videoDetails?.videoId ||
        new URLSearchParams(root.location.search).get("v") ||
        extractShortsVideoId(root.location.pathname),
      captionTracks: captionRenderer.captionTracks || [],
      translationLanguages: captionRenderer.translationLanguages || [],
      transcriptParams: findTranscriptParams(initialData),
      observedTranscriptRequest: root.__scriptLensObservedTranscriptRequest || null,
      videoDurationSeconds: toFiniteNumber(playerResponse?.videoDetails?.lengthSeconds),
      originalLanguageCode:
        captionRenderer.defaultAudioTrackIndex != null
          ? captionRenderer.captionTracks?.[captionRenderer.defaultAudioTrackIndex]?.languageCode || null
          : captionRenderer.captionTracks?.[0]?.languageCode || null,
      hasGeneratedCaptions: Array.isArray(captionRenderer.captionTracks)
        ? captionRenderer.captionTracks.some((track) => track?.kind === "asr")
        : false,
      updatedAt: Date.now()
    };
  }

  function readPlayerResponse() {
    const raw =
      root.ytInitialPlayerResponse ||
      root.ytplayer?.config?.args?.raw_player_response ||
      root.ytplayer?.config?.args?.player_response ||
      null;

    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch (error) {
        return null;
      }
    }

    return raw || null;
  }

  function buildClientContextFromConfig(ytcfgData) {
    const clientName =
      ytcfgData.INNERTUBE_CONTEXT_CLIENT_NAME || root.INNERTUBE_CONTEXT_CLIENT_NAME;
    const clientVersion =
      ytcfgData.INNERTUBE_CONTEXT_CLIENT_VERSION || root.INNERTUBE_CONTEXT_CLIENT_VERSION;
    const hl = ytcfgData.HL || "en";
    const gl = ytcfgData.GL || "US";

    if (!clientName || !clientVersion) {
      return null;
    }

    return {
      client: {
        clientName,
        clientVersion,
        hl,
        gl
      }
    };
  }

  function findTranscriptParams(source) {
    const queue = [source];
    const seen = new Set();

    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== "object" || seen.has(current)) {
        continue;
      }
      seen.add(current);

      if (
        current.getTranscriptEndpoint &&
        typeof current.getTranscriptEndpoint.params === "string"
      ) {
        return current.getTranscriptEndpoint.params;
      }

      if (
        current.showTranscriptButton &&
        current.showTranscriptButton.buttonRenderer?.serviceEndpoint?.getTranscriptEndpoint
          ?.params
      ) {
        return current.showTranscriptButton.buttonRenderer.serviceEndpoint.getTranscriptEndpoint.params;
      }

      Object.keys(current).forEach((key) => {
        const value = current[key];
        if (value && typeof value === "object") {
          queue.push(value);
        }
      });
    }

    return "";
  }

  function extractShortsVideoId(pathname) {
    const match = String(pathname || "").match(/^\/shorts\/([^/?#]+)/);
    return match ? match[1] : "";
  }

  function installTranscriptRequestObserver() {
    if (root.__scriptLensTranscriptObserverInstalled) {
      return;
    }

    root.__scriptLensTranscriptObserverInstalled = true;
    const originalFetch = root.fetch;
    if (typeof originalFetch === "function") {
      root.fetch = function patchedFetch(input, init) {
        captureTranscriptRequest(input, init);
        return originalFetch.apply(this, arguments);
      };
    }
  }

  function captureTranscriptRequest(input, init) {
    const requestUrl = readRequestUrl(input);
    if (!/\/youtubei\/v1\/get_transcript\b/i.test(requestUrl)) {
      return;
    }

    const headers = normalizeHeaders(
      init?.headers || (typeof Request !== "undefined" && input instanceof Request ? input.headers : null)
    );
    const payload = parseRequestBody(init?.body);

    root.__scriptLensObservedTranscriptRequest = {
      url: requestUrl,
      params: payload?.params || null,
      clientName:
        headers["x-youtube-client-name"] ||
        payload?.context?.client?.clientName ||
        null,
      clientVersion:
        headers["x-youtube-client-version"] ||
        payload?.context?.client?.clientVersion ||
        null,
      observedAt: Date.now()
    };
  }

  function readRequestUrl(input) {
    if (typeof input === "string") {
      return input;
    }
    if (input && typeof input.url === "string") {
      return input.url;
    }
    return "";
  }

  function normalizeHeaders(headers) {
    const output = {};
    if (!headers) {
      return output;
    }

    if (typeof headers.forEach === "function") {
      headers.forEach((value, key) => {
        output[String(key || "").toLowerCase()] = String(value || "");
      });
      return output;
    }

    Object.keys(headers).forEach((key) => {
      output[String(key || "").toLowerCase()] = String(headers[key] || "");
    });
    return output;
  }

  function parseRequestBody(body) {
    if (!body || typeof body !== "string") {
      return null;
    }

    try {
      return JSON.parse(body);
    } catch (error) {
      return null;
    }
  }

  function toFiniteNumber(value) {
    const nextValue = Number(value);
    return Number.isFinite(nextValue) ? nextValue : null;
  }
})(globalThis);
