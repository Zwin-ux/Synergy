importScripts(
  "utils/text.js",
  "utils/stats.js",
  "detector/patterns.js",
  "detector/heuristics.js",
  "detector/scoring.js",
  "detector/analyze.js"
);

const STORAGE_KEYS = {
  settings: "settings",
  recentReports: "recentReports",
  sitePreferences: "sitePreferences",
  uiHints: "uiHints"
};

const SESSION_KEYS = {
  panelLaunchRequest: "panelLaunchRequest"
};

const DEFAULT_SETTINGS = {
  sensitivity: "medium",
  maxTextLength: 18000,
  minCharacters: 180,
  minWords: 40,
  recentReportsLimit: 5
};

const DEFAULT_UI_HINTS = {
  sidePanelIntroDismissed: false,
  youtubeIntroDismissed: false,
  lowQualityHintDismissed: false
};

chrome.runtime.onInstalled.addListener(async () => {
  const localValues = await localGet([
    STORAGE_KEYS.settings,
    STORAGE_KEYS.recentReports,
    STORAGE_KEYS.sitePreferences,
    STORAGE_KEYS.uiHints
  ]);

  const nextValues = {};
  if (!localValues[STORAGE_KEYS.settings]) {
    nextValues[STORAGE_KEYS.settings] = DEFAULT_SETTINGS;
  }
  if (!Array.isArray(localValues[STORAGE_KEYS.recentReports])) {
    nextValues[STORAGE_KEYS.recentReports] = [];
  }
  if (!localValues[STORAGE_KEYS.sitePreferences]) {
    nextValues[STORAGE_KEYS.sitePreferences] = {};
  }
  if (!localValues[STORAGE_KEYS.uiHints]) {
    nextValues[STORAGE_KEYS.uiHints] = DEFAULT_UI_HINTS;
  }

  if (Object.keys(nextValues).length) {
    await localSet(nextValues);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error?.message || "Unexpected extension error."
      })
    );

  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "popup:init":
      return buildPopupInitResponse();
    case "panel:init":
      return buildPanelInitResponse();
    case "panel:open":
      return openWorkspace(message.request || null, sender);
    case "panel:analyze":
      return handlePanelAnalyze(message.request || {});
    case "video:sources":
      return getVideoSources();
    case "sitePreferences:get":
      return {
        ok: true,
        sitePreference: await getSitePreference(message.hostname || (await getCurrentHost()))
      };
    case "sitePreferences:set":
      return {
        ok: true,
        sitePreference: await saveSitePreference(
          message.hostname || (await getCurrentHost()),
          message.updates || {}
        )
      };
    case "uiHints:update":
      return {
        ok: true,
        uiHints: await updateUiHints(message.updates || {})
      };
    case "settings:update":
      return {
        ok: true,
        settings: await saveSettings(message.settings || {}),
        recentReports: await loadRecentReports(),
        pageContext: await getHydratedPageContext()
      };
    default:
      return {
        ok: false,
        error: "Unsupported action."
      };
  }
}

async function buildPopupInitResponse() {
  const recentReports = await loadRecentReports();
  const pageContext = await getHydratedPageContext();

  return {
    ok: true,
    settings: await loadSettings(),
    recentReports,
    lastReport: recentReports[0] || null,
    pageContext
  };
}

async function buildPanelInitResponse() {
  const pageContext = await getHydratedPageContext();
  return {
    ok: true,
    settings: await loadSettings(),
    recentReports: await loadRecentReports(),
    pageContext,
    sitePreference: await getSitePreference(pageContext?.hostname || ""),
    uiHints: await loadUiHints(),
    launchRequest: await loadLaunchRequest()
  };
}

async function openWorkspace(request, sender) {
  const tab = await resolveTabFromSender(sender);
  if (!tab?.id) {
    return {
      ok: false,
      error: "No active browser tab is available."
    };
  }

  const pageContext = await getHydratedPageContext(tab);
  const normalizedRequest =
    request === null ? null : resolveRequestedAction(pageContext, request || { mode: "recommended" });

  if (normalizedRequest) {
    await saveLaunchRequest({
      tabId: tab.id,
      windowId: tab.windowId,
      request: normalizedRequest,
      createdAt: Date.now()
    });
  } else {
    await clearLaunchRequest();
  }

  await openSidePanel(tab.windowId);

  return {
    ok: true,
    pageContext,
    launchRequest: normalizedRequest
  };
}

async function handlePanelAnalyze(request) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return {
      ok: false,
      error: "No active browser tab is available."
    };
  }

  const pageContext = await getHydratedPageContext(tab);
  const normalizedRequest = resolveRequestedAction(pageContext, request || { mode: "recommended" });
  if (!normalizedRequest) {
    return {
      ok: false,
      error: "No suitable source is available for analysis."
    };
  }

  await clearLaunchRequest();

  const analysisResult =
    normalizedRequest.mode === "manual"
      ? await analyzeManualText(normalizedRequest)
      : await analyzeTabRequest(tab, normalizedRequest);

  if (!analysisResult.ok) {
    return analysisResult;
  }

  if (pageContext?.hostname) {
    await rememberSuccessfulRequest(pageContext.hostname, normalizedRequest, analysisResult.sourceMeta);
  }

  await clearLaunchRequest();

  return {
    ok: true,
    report: analysisResult.report,
    recentReports: await loadRecentReports(),
    settings: await loadSettings(),
    pageContext: await getHydratedPageContext(tab),
    sitePreference: await getSitePreference(pageContext?.hostname || ""),
    uiHints: await loadUiHints()
  };
}

async function getVideoSources() {
  const pageContext = await getHydratedPageContext();
  return {
    ok: true,
    pageContext,
    video: pageContext?.video || null
  };
}

async function analyzeManualText(request) {
  return runTextAnalysis(request.text, "Pasted text", {
    sourceType: "manual",
    includedSources: ["manual"]
  });
}

async function analyzeTabRequest(tab, request) {
  try {
    await ensureContentScripts(tab.id);
  } catch (error) {
    return {
      ok: false,
      error:
        "This page does not allow extension text access. Try a regular web page instead."
    };
  }

  const payload = await sendTabMessage(tab.id, {
    type: "extract:panel-input",
    request
  });

  if (!payload?.ok) {
    return {
      ok: false,
      error: payload?.error || "No usable text could be extracted from this page."
    };
  }

  return runTextAnalysis(payload.text, buildSourceLabel(payload.meta), payload.meta);
}

async function runTextAnalysis(text, sourceLabel, sourceMeta) {
  const settings = await loadSettings();
  const result = globalThis.AIScriptDetector.analyze.runAnalysis(text, {
    ...settings,
    source: sourceLabel
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      settings
    };
  }

  const enrichedReport = enrichReport(result.report, sourceMeta || {});
  await persistRecentReport(enrichedReport, settings.recentReportsLimit);

  return {
    ok: true,
    report: enrichedReport,
    sourceMeta: sourceMeta || {}
  };
}

function enrichReport(report, sourceMeta) {
  const quality = buildInputQuality(report, sourceMeta);
  const interpretation = buildInterpretation(quality, sourceMeta);

  return {
    ...report,
    quality,
    interpretation,
    sourceMeta: {
      ...sourceMeta
    },
    metadata: {
      ...report.metadata,
      sourceType: sourceMeta.sourceType || "",
      includedSources: sourceMeta.includedSources || [],
      transcriptSegmentCount: sourceMeta.transcriptSegmentCount || 0
    }
  };
}

function buildInputQuality(report, sourceMeta) {
  const includedSources = Array.isArray(sourceMeta.includedSources)
    ? sourceMeta.includedSources
    : sourceMeta.sourceType
      ? [sourceMeta.sourceType]
      : [];

  let score = 12;
  const reasons = [];

  if (includedSources.includes("transcript")) {
    score += 38;
    reasons.push("Transcript text reduces layout and navigation noise.");
  }
  if (includedSources.includes("selection")) {
    score += 28;
    reasons.push("Selected text is narrowly scoped to the passage you chose.");
  }
  if (includedSources.includes("page")) {
    score += 18;
    reasons.push("Visible page capture keeps the analysis tied to the main readable content.");
  }
  if (includedSources.includes("description")) {
    score += 14;
    reasons.push("The video description adds authored context around the transcript.");
  }
  if (includedSources.includes("title")) {
    score += 6;
  }
  if (sourceMeta.sourceType === "manual") {
    score += 26;
    reasons.push("Pasted text avoids page extraction noise.");
  }

  const wordCount = report.metadata?.wordCount || 0;
  if (wordCount >= 700) {
    score += 24;
  } else if (wordCount >= 400) {
    score += 18;
  } else if (wordCount >= 220) {
    score += 12;
  } else if (wordCount >= 120) {
    score += 6;
  }

  if (typeof sourceMeta.coverageRatio === "number") {
    if (sourceMeta.coverageRatio >= 0.55) {
      score += 12;
    } else if (sourceMeta.coverageRatio >= 0.35) {
      score += 8;
    } else if (sourceMeta.coverageRatio >= 0.2) {
      score += 4;
    } else {
      score -= 4;
      reasons.push("The captured text appears to include more page noise than ideal.");
    }
  }

  if (includedSources.includes("transcript")) {
    const segmentCount = sourceMeta.transcriptSegmentCount || 0;
    if (segmentCount >= 40) {
      score += 12;
    } else if (segmentCount >= 15) {
      score += 8;
    } else if (segmentCount >= 5) {
      score += 4;
    } else {
      score -= 4;
    }
  }

  if (includedSources.length >= 2) {
    score += 6;
    reasons.push("Multiple complementary sources make the read more stable.");
  }

  const clampedScore = clampNumber(score, 0, 100, 0);
  const label =
    clampedScore >= 75 ? "Strong input" : clampedScore >= 50 ? "Useful input" : "Weak input";
  const summary =
    clampedScore >= 75
      ? "This analysis is based on a relatively clean and substantial input."
      : clampedScore >= 50
        ? "This analysis is useful, but source quality still matters when reading the score."
        : "Treat this as directional only. The input is short, noisy, or missing stronger source material.";

  return {
    score: clampedScore,
    label,
    summary,
    reasons: reasons.slice(0, 4)
  };
}

function buildInterpretation(quality, sourceMeta) {
  const usesTranscript = Array.isArray(sourceMeta.includedSources)
    ? sourceMeta.includedSources.includes("transcript")
    : false;

  return {
    headline: "How to read this score",
    means:
      "The score reflects how strongly the writing matches AI-like patterns in structure, phrasing, and rhythm.",
    notMeans:
      "It is not proof of authorship and should not be treated as a definitive human-vs-AI judgment.",
    falsePositives: [
      "Highly polished scripts, voiceovers, study guides, and SEO copy can trigger strong pattern matches.",
      "Short excerpts and page captures with little context can overstate the signal.",
      usesTranscript
        ? "Edited transcripts can sound more uniform than the original spoken performance."
        : "Heavily edited marketing or educational copy can read as more templated than its source."
    ],
    trustMore: quality.score >= 75
      ? [
          "The input is long enough to surface repeated structure instead of one-off phrasing.",
          "The source is relatively clean, which lowers the chance of page noise distorting the read."
        ]
      : [
          "Use longer text and cleaner sources for a more stable result.",
          "On YouTube, transcripts usually give a better read than page text alone."
        ]
  };
}

function buildSourceLabel(meta) {
  const titleSuffix = meta?.title ? ` - ${meta.title}` : "";
  if (meta?.sourceType === "selection") {
    return `Selection${titleSuffix}`;
  }
  if (meta?.sourceType === "page") {
    return `Page${titleSuffix}`;
  }
  if (meta?.sourceType === "manual") {
    return "Pasted text";
  }
  if (meta?.sourceType === "youtube") {
    const parts = [];
    if (Array.isArray(meta.includedSources)) {
      if (meta.includedSources.includes("transcript")) {
        parts.push("Transcript");
      }
      if (meta.includedSources.includes("description")) {
        parts.push("Description");
      }
      if (meta.includedSources.includes("title")) {
        parts.push("Title");
      }
    }

    return `YouTube video${titleSuffix}${parts.length ? ` - ${parts.join(" + ")}` : ""}`;
  }

  return meta?.title ? `Local analysis - ${meta.title}` : "Local analysis";
}

async function getHydratedPageContext(tab) {
  const resolvedTab = tab || (await getActiveTab().catch(() => null));
  if (!resolvedTab?.id) {
    return {
      supported: false
    };
  }

  try {
    await ensureContentScripts(resolvedTab.id);
    const payload = await sendTabMessage(resolvedTab.id, { type: "page:context" });
    if (!payload?.ok) {
      return {
        supported: false,
        error: payload?.error || "Context capture unavailable."
      };
    }

    const rawContext = payload.context || { supported: true };
    const sitePreference = await getSitePreference(rawContext.hostname || "");
    return hydratePageContext(rawContext, sitePreference, resolvedTab);
  } catch (error) {
    return {
      supported: false,
      tabId: resolvedTab.id,
      windowId: resolvedTab.windowId,
      url: resolvedTab.url || "",
      error: "This page does not allow ScriptLens access."
    };
  }
}

function hydratePageContext(rawContext, sitePreference, tab) {
  if (!rawContext?.supported) {
    return {
      ...(rawContext || { supported: false }),
      tabId: tab?.id || null,
      windowId: tab?.windowId || null,
      url: tab?.url || ""
    };
  }

  const normalizedHost = normalizeHost(rawContext.hostname || "");
  const preference = sitePreference || {};
  const recommendedRequest = buildRecommendedRequest(rawContext, preference);
  const video = rawContext.video
    ? {
        ...rawContext.video,
        defaultPreset:
          recommendedRequest?.mode === "youtube"
            ? {
                includeSources: recommendedRequest.includeSources || [],
                trackBaseUrl: recommendedRequest.trackBaseUrl || ""
              }
            : buildDefaultVideoPreset(rawContext.video)
      }
    : null;

  return {
    ...rawContext,
    hostname: normalizedHost,
    tabId: tab?.id || null,
    windowId: tab?.windowId || null,
    url: tab?.url || "",
    recommendedMode: recommendedRequest?.mode || null,
    recommendedRequest,
    video
  };
}

function buildDefaultVideoPreset(video) {
  if (!video) {
    return null;
  }

  if (video.availableSources?.transcript) {
    return {
      includeSources: ["transcript"],
      trackBaseUrl: video.defaultTrackBaseUrl || ""
    };
  }

  const fallbackSources = [];
  if (video.availableSources?.description) {
    fallbackSources.push("description");
  }
  if (video.availableSources?.title) {
    fallbackSources.push("title");
  }

  return {
    includeSources: fallbackSources,
    trackBaseUrl: ""
  };
}

function buildRecommendedRequest(context, sitePreference) {
  if (context.isYouTubeVideo && context.video) {
    return buildRecommendedVideoRequest(context.video, sitePreference);
  }

  if (
    sitePreference?.preferredCaptureMode === "selection" &&
    context.selectionAvailable
  ) {
    return {
      mode: "selection"
    };
  }

  if (sitePreference?.preferredCaptureMode === "page" && context.pageAvailable) {
    return {
      mode: "page"
    };
  }

  if (context.selectionAvailable) {
    return {
      mode: "selection"
    };
  }

  if (context.pageAvailable) {
    return {
      mode: "page"
    };
  }

  return null;
}

function buildRecommendedVideoRequest(video, sitePreference) {
  const available = video.availableSources || {};
  const preferredSources = Array.isArray(sitePreference?.youtubePreset?.includeSources)
    ? sitePreference.youtubePreset.includeSources.filter(Boolean)
    : ["transcript"];

  const nextSources = preferredSources.filter((source) => {
    if (source === "transcript") {
      return available.transcript;
    }
    if (source === "description") {
      return available.description;
    }
    if (source === "title") {
      return available.title;
    }
    return false;
  });

  const includeSources = nextSources.length
    ? nextSources
    : available.transcript
      ? ["transcript"]
      : [available.description ? "description" : null, available.title ? "title" : null].filter(Boolean);

  return includeSources.length
    ? {
        mode: "youtube",
        includeSources,
        transcriptBias: sitePreference?.transcriptBias || "manual-en",
        trackBaseUrl: pickPreferredTrack(video.transcriptTracks || [], sitePreference?.transcriptBias)
      }
    : null;
}

function resolveRequestedAction(pageContext, request) {
  if (!request || request.mode === "recommended") {
    return pageContext?.recommendedRequest || null;
  }

  if (request.mode === "selection" || request.mode === "page") {
    return {
      mode: request.mode
    };
  }

  if (request.mode === "manual") {
    return {
      mode: "manual",
      text: String(request.text || "")
    };
  }

  if (request.mode === "youtube") {
    const includeSources = normalizeVideoSources(request.includeSources);
    return {
      mode: "youtube",
      includeSources,
      transcriptBias: request.transcriptBias || "manual-en",
      trackBaseUrl: request.trackBaseUrl || pickPreferredTrack(pageContext?.video?.transcriptTracks || [], request.transcriptBias)
    };
  }

  return null;
}

async function rememberSuccessfulRequest(hostname, request, sourceMeta) {
  const normalizedHost = normalizeHost(hostname);
  if (!normalizedHost || request.mode === "manual") {
    return;
  }

  const existing = await getSitePreference(normalizedHost);
  const updates = {};

  if (request.mode === "selection" || request.mode === "page") {
    updates.preferredCaptureMode = request.mode;
  }

  if (request.mode === "youtube") {
    updates.preferredCaptureMode = "youtube";
    updates.youtubePreset = {
      includeSources: normalizeVideoSources(request.includeSources)
    };
    updates.transcriptBias = deriveTranscriptBias(sourceMeta?.selectedTrack);
  }

  await saveSitePreference(normalizedHost, {
    ...existing,
    ...updates,
    updatedAt: Date.now()
  });
}

function deriveTranscriptBias(track) {
  if (!track) {
    return "manual-en";
  }

  const languageCode = String(track.languageCode || "").toLowerCase();
  if (languageCode.startsWith("en") && track.kind === "asr") {
    return "auto-en";
  }
  if (languageCode.startsWith("en")) {
    return "manual-en";
  }
  if (track.kind === "asr") {
    return "auto-any";
  }
  return "manual-any";
}

function pickPreferredTrack(tracks, transcriptBias) {
  if (!Array.isArray(tracks) || !tracks.length) {
    return "";
  }

  const bias = transcriptBias || "manual-en";
  const normalized = tracks.map((track) => ({
    ...track,
    languageCode: String(track.languageCode || "").toLowerCase()
  }));

  const manualEnglish =
    normalized.find((track) => track.languageCode === "en" && track.kind !== "asr") ||
    normalized.find((track) => track.languageCode.startsWith("en-") && track.kind !== "asr");
  const autoEnglish =
    normalized.find((track) => track.languageCode === "en") ||
    normalized.find((track) => track.languageCode.startsWith("en-"));
  const manualAny = normalized.find((track) => track.kind !== "asr");

  if (bias === "manual-en") {
    return (manualEnglish || autoEnglish || manualAny || normalized[0]).baseUrl || "";
  }
  if (bias === "auto-en") {
    return (autoEnglish || manualEnglish || manualAny || normalized[0]).baseUrl || "";
  }
  if (bias === "manual-any") {
    return (manualAny || autoEnglish || normalized[0]).baseUrl || "";
  }
  if (bias === "auto-any") {
    return (normalized.find((track) => track.kind === "asr") || autoEnglish || manualAny || normalized[0]).baseUrl || "";
  }
  return (normalized[0] || {}).baseUrl || "";
}

async function loadSettings() {
  const { settings } = await localGet([STORAGE_KEYS.settings]);
  return normalizeSettings(settings || {});
}

async function saveSettings(nextSettings) {
  const merged = normalizeSettings({
    ...(await loadSettings()),
    ...nextSettings
  });
  await localSet({
    [STORAGE_KEYS.settings]: merged
  });
  return merged;
}

async function loadRecentReports() {
  const { recentReports } = await localGet([STORAGE_KEYS.recentReports]);
  return Array.isArray(recentReports) ? recentReports : [];
}

async function persistRecentReport(report, limit) {
  const current = await loadRecentReports();
  const stored = [summarizeReport(report), ...current].slice(
    0,
    limit || DEFAULT_SETTINGS.recentReportsLimit
  );

  await localSet({
    [STORAGE_KEYS.recentReports]: stored
  });
}

function summarizeReport(report) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    source: report.source,
    score: report.score,
    verdict: report.verdict,
    qualityLabel: report.quality?.label || "",
    preview: report.metadata?.preview || "No preview available",
    topReasons: (report.topReasons || []).slice(0, 3)
  };
}

async function getSitePreference(hostname) {
  const normalizedHost = normalizeHost(hostname);
  if (!normalizedHost) {
    return {};
  }

  const { sitePreferences } = await localGet([STORAGE_KEYS.sitePreferences]);
  return sitePreferences?.[normalizedHost] || {};
}

async function saveSitePreference(hostname, updates) {
  const normalizedHost = normalizeHost(hostname);
  if (!normalizedHost) {
    return {};
  }

  const { sitePreferences } = await localGet([STORAGE_KEYS.sitePreferences]);
  const currentPreference = sitePreferences?.[normalizedHost] || {};
  const nextPreferences = {
    ...(sitePreferences || {}),
    [normalizedHost]: {
      ...currentPreference,
      ...(updates || {})
    }
  };

  await localSet({
    [STORAGE_KEYS.sitePreferences]: nextPreferences
  });

  return nextPreferences[normalizedHost];
}

async function loadUiHints() {
  const { uiHints } = await localGet([STORAGE_KEYS.uiHints]);
  return {
    ...DEFAULT_UI_HINTS,
    ...(uiHints || {})
  };
}

async function updateUiHints(updates) {
  const nextHints = {
    ...(await loadUiHints()),
    ...updates
  };

  await localSet({
    [STORAGE_KEYS.uiHints]: nextHints
  });

  return nextHints;
}

async function loadLaunchRequest() {
  const { panelLaunchRequest } = await sessionGet([SESSION_KEYS.panelLaunchRequest]);
  return panelLaunchRequest || null;
}

async function saveLaunchRequest(value) {
  await sessionSet({
    [SESSION_KEYS.panelLaunchRequest]: value
  });
}

async function clearLaunchRequest() {
  await sessionRemove([SESSION_KEYS.panelLaunchRequest]);
}

function normalizeSettings(input) {
  const sensitivity = ["low", "medium", "high"].includes(input.sensitivity)
    ? input.sensitivity
    : DEFAULT_SETTINGS.sensitivity;
  const maxTextLength = clampNumber(
    input.maxTextLength,
    4000,
    50000,
    DEFAULT_SETTINGS.maxTextLength
  );

  return {
    ...DEFAULT_SETTINGS,
    sensitivity,
    maxTextLength
  };
}

function normalizeVideoSources(value) {
  const allowed = new Set(["transcript", "description", "title"]);
  const list = Array.isArray(value) ? value : [];
  const normalized = list.filter((source) => allowed.has(source));
  return normalized.length ? normalized : ["transcript"];
}

function normalizeHost(hostname) {
  return String(hostname || "").replace(/^www\./, "");
}

async function getCurrentHost() {
  const pageContext = await getHydratedPageContext();
  return pageContext?.hostname || "";
}

async function resolveTabFromSender(sender) {
  if (sender?.tab?.id) {
    return sender.tab;
  }
  return getActiveTab();
}

async function ensureContentScripts(tabId) {
  await executeScript({
    target: { tabId },
    files: ["utils/text.js", "utils/stats.js", "utils/dom.js", "content.js"]
  });
}

async function openSidePanel(windowId) {
  return new Promise((resolve, reject) => {
    chrome.sidePanel.open({ windowId }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(tabs[0] || null);
    });
  });
}

function executeScript(details) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(details, (results) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(results || []);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(response);
    });
  });
}

function localGet(keys) {
  return storageAreaGet(chrome.storage.local, keys);
}

function localSet(value) {
  return storageAreaSet(chrome.storage.local, value);
}

function sessionGet(keys) {
  return storageAreaGet(chrome.storage.session, keys);
}

function sessionSet(value) {
  return storageAreaSet(chrome.storage.session, value);
}

function sessionRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.session.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

function storageAreaGet(area, keys) {
  return new Promise((resolve, reject) => {
    area.get(keys, (value) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(value);
    });
  });
}

function storageAreaSet(area, value) {
  return new Promise((resolve, reject) => {
    area.set(value, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

function clampNumber(value, min, max, fallback) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(nextValue)));
}
