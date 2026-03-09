const { chromium } = require("@playwright/test");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_TOTAL_TIMEOUT_MS = 6500;
const STATIC_STAGE_TIMEOUT_MS = 2800;
const YOUTUBEI_STAGE_TIMEOUT_MS = 1200;
const YT_DLP_STAGE_TIMEOUT_MS = 2500;
const HEADLESS_STAGE_TIMEOUT_MS = 3200;
const WATCH_PAGE_HEADERS = {
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
};

module.exports = {
  DEFAULT_TOTAL_TIMEOUT_MS,
  HEADLESS_STAGE_TIMEOUT_MS,
  STATIC_STAGE_TIMEOUT_MS,
  YOUTUBEI_STAGE_TIMEOUT_MS,
  YT_DLP_STAGE_TIMEOUT_MS,
  resolveTranscriptRequest,
  pickPreferredTrack,
  parseCaptionPayload
};

async function resolveTranscriptRequest(input, options = {}) {
  const request = normalizeRequest(input);
  if (!request.url || !request.videoId) {
    return buildFailurePayload({
      errorCode: "invalid_request",
      errorMessage: "A YouTube video URL or video ID is required.",
      warnings: ["backend_invalid_request"]
    });
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return buildFailurePayload({
      errorCode: "fetch_unavailable",
      errorMessage: "The backend runtime does not expose fetch().",
      warnings: ["backend_fetch_unavailable"]
    });
  }

  const totalTimeoutMs = clampNumber(
    options.totalTimeoutMs,
    1000,
    20000,
    DEFAULT_TOTAL_TIMEOUT_MS
  );
  const deadlineAt = Date.now() + totalTimeoutMs;
  const stageWarnings = [];
  const stageErrors = [];
  let pageData = null;
  let bestResult = null;

  const staticStage = await runStage(
    "static-caption-track",
    deadlineAt,
    options.staticStageTimeoutMs || STATIC_STAGE_TIMEOUT_MS,
    options.signal,
    (signal) =>
      resolveFromStaticPage(request, {
        fetchImpl,
        signal
      })
  );
  pageData = staticStage.pageData || pageData;
  mergeStage(stageWarnings, stageErrors, staticStage);
  if (staticStage.ok) {
    bestResult = staticStage.payload;
    if (isStrongTranscript(bestResult)) {
      return bestResult;
    }
  }

  const youtubeiStage = await runStage(
    "youtubei-command",
    deadlineAt,
    options.youtubeiStageTimeoutMs || YOUTUBEI_STAGE_TIMEOUT_MS,
    options.signal,
    (signal) =>
      resolveFromYoutubei(request, {
        fetchImpl,
        signal,
        pageData
      })
  );
  pageData = youtubeiStage.pageData || pageData;
  mergeStage(stageWarnings, stageErrors, youtubeiStage);
  if (youtubeiStage.ok) {
    bestResult = chooseBestBackendResult(bestResult, youtubeiStage.payload);
    if (isStrongTranscript(bestResult)) {
      return bestResult;
    }
  }

  const ytDlpStage = await runStage(
    "yt-dlp-captions",
    deadlineAt,
    options.ytDlpStageTimeoutMs || YT_DLP_STAGE_TIMEOUT_MS,
    options.signal,
    (signal) =>
      resolveFromYtDlp(request, {
        signal,
        pageData,
        ytDlpResolver: options.ytDlpResolver,
        ytDlpCommand: options.ytDlpCommand,
        ytDlpPythonPath: options.ytDlpPythonPath,
        ytDlpPythonCommand: options.ytDlpPythonCommand
      })
  );
  pageData = ytDlpStage.pageData || pageData;
  mergeStage(stageWarnings, stageErrors, ytDlpStage);
  if (ytDlpStage.ok) {
    bestResult = chooseBestBackendResult(bestResult, ytDlpStage.payload);
    if (isStrongTranscript(bestResult)) {
      return bestResult;
    }
  }

  const headlessStage = await runStage(
    "headless-transcript-panel",
    deadlineAt,
    options.headlessStageTimeoutMs || HEADLESS_STAGE_TIMEOUT_MS,
    options.signal,
    (signal) =>
      resolveFromHeadless(request, {
        chromiumLauncher: options.chromiumLauncher || chromium,
        signal,
        pageData,
        headlessResolver: options.headlessResolver
      })
  );
  mergeStage(stageWarnings, stageErrors, headlessStage);
  if (headlessStage.ok) {
    bestResult = chooseBestBackendResult(bestResult, headlessStage.payload);
  }

  if (bestResult) {
    return {
      ...bestResult,
      warnings: dedupeList([]
        .concat(bestResult.warnings || [])
        .concat(stageWarnings))
    };
  }

  const primaryFailure =
    stageErrors.find((entry) => entry.errorCode === "backend_timeout") ||
    stageErrors.find((entry) => entry.errorCode === "backend_aborted") ||
    stageErrors[stageErrors.length - 1] || {
    errorCode: "backend_transcript_unavailable",
    errorMessage: "No transcript-class source was available for this video."
  };

  return buildFailurePayload({
    errorCode: primaryFailure.errorCode,
    errorMessage: primaryFailure.errorMessage,
    warnings: stageWarnings,
    videoDurationSeconds: pageData?.videoDurationSeconds || null
  });
}

async function runStage(name, deadlineAt, stageTimeoutMs, parentSignal, runner) {
  const remainingMs = Math.max(0, deadlineAt - Date.now());
  if (remainingMs <= 0) {
    return {
      ok: false,
      warnings: [`${name}_skipped_timeout`],
      errorCode: "backend_timeout",
      errorMessage: "The backend transcript budget expired before the next stage could run."
    };
  }

  const budgetMs = Math.max(
    1,
    Math.min(clampNumber(stageTimeoutMs, 100, 20000, remainingMs), remainingMs)
  );
  const controller = new AbortController();
  const cleanupAbort = linkAbortSignal(parentSignal, controller);
  const timeoutHandle = createAbortTimeout(controller, budgetMs);

  try {
    const result = await Promise.race([
      Promise.resolve().then(() => runner(controller.signal)),
      waitForAbort(controller.signal)
    ]);
    return result || {
      ok: false,
      warnings: [`${name}_empty`],
      errorCode: "backend_empty",
      errorMessage: "The stage returned no result."
    };
  } catch (error) {
    const code = controller.signal.aborted && !parentSignal?.aborted
      ? "backend_timeout"
      : parentSignal?.aborted
        ? "backend_aborted"
        : "backend_stage_failed";
    return {
      ok: false,
      warnings: [code, `${name}_failed`],
      errorCode: code,
      errorMessage: error?.message || "The backend transcript stage failed."
    };
  } finally {
    clearTimeout(timeoutHandle);
    cleanupAbort();
  }
}

function mergeStage(stageWarnings, stageErrors, stageResult) {
  (stageResult?.warnings || []).forEach((warning) => stageWarnings.push(warning));
  if (!stageResult?.ok && stageResult?.errorCode) {
    stageErrors.push({
      errorCode: stageResult.errorCode,
      errorMessage: stageResult.errorMessage || "Transcript resolution failed."
    });
  }
}

async function resolveFromStaticPage(request, options) {
  const response = await options.fetchImpl(request.url, {
    headers: WATCH_PAGE_HEADERS,
    method: "GET",
    signal: options.signal
  });

  if (!response.ok) {
    return {
      ok: false,
      warnings: ["watch_page_fetch_failed"],
      errorCode: `watch_page_http_${response.status}`,
      errorMessage: `The YouTube watch page returned ${response.status}.`
    };
  }

  const html = await response.text();
  const playerResponse = extractAssignedObject(html, [
    "var ytInitialPlayerResponse = ",
    "ytInitialPlayerResponse = ",
    "window[\"ytInitialPlayerResponse\"] = "
  ]);
  const initialData = extractAssignedObject(html, [
    "var ytInitialData = ",
    "ytInitialData = ",
    "window[\"ytInitialData\"] = "
  ]);
  const ytcfg = extractYtcfg(html);
  const pageData = {
    html,
    playerResponse,
    initialData,
    ytcfg,
    videoDurationSeconds: toFiniteNumber(playerResponse?.videoDetails?.lengthSeconds)
  };

  const captionTracks = readCaptionTracks(playerResponse);
  if (!captionTracks.length) {
    return {
      ok: false,
      warnings: ["caption_tracks_missing"],
      errorCode: "caption_tracks_missing",
      errorMessage: "The watch page exposed no caption tracks.",
      pageData
    };
  }

  const track = pickPreferredTrack(captionTracks, request.requestedLanguageCode);
  if (!track?.baseUrl) {
    return {
      ok: false,
      warnings: ["caption_track_unavailable"],
      errorCode: "caption_track_unavailable",
      errorMessage: "No usable caption track could be selected on the watch page.",
      pageData
    };
  }

  const captionPayload = await fetchCaptionTrack(track.baseUrl, {
    fetchImpl: options.fetchImpl,
    signal: options.signal
  });

  if (!captionPayload.text) {
    return {
      ok: false,
      warnings: ["caption_fetch_failed"],
      errorCode: "caption_fetch_failed",
      errorMessage: "Caption tracks were present, but the transcript payload could not be read.",
      pageData
    };
  }

  return {
    ok: true,
    warnings: [],
    pageData,
    payload: buildSuccessPayload({
      text: captionPayload.text,
      segments: captionPayload.segments,
      sourceLabel: track.kind === "asr" ? "Backend auto captions" : "Backend caption track",
      sourceConfidence: track.kind === "asr" ? "medium" : "high",
      warnings: []
        .concat(track.kind === "asr" ? ["generated_captions"] : [])
        .concat(["backend_static_caption_track"]),
      languageCode: normalizeLanguage(track.languageCode),
      originalLanguageCode: normalizeLanguage(track.languageCode),
      isGenerated: track.kind === "asr",
      isTranslated: false,
      isMachineTranslated: false,
      videoDurationSeconds: pageData.videoDurationSeconds
    })
  };
}

async function resolveFromYoutubei(request, options) {
  const pageData = options.pageData || {};
  const apiKey = readInnertubeValue(pageData, "INNERTUBE_API_KEY");
  const clientName = readInnertubeValue(pageData, "INNERTUBE_CONTEXT_CLIENT_NAME") || "WEB";
  const clientVersion = readInnertubeValue(pageData, "INNERTUBE_CONTEXT_CLIENT_VERSION");
  const clientContext = readClientContext(pageData, clientName, clientVersion);
  const transcriptParams = findTranscriptParams(pageData.initialData || pageData.playerResponse);

  if (!apiKey || !clientContext || !clientVersion) {
    return {
      ok: false,
      warnings: ["youtubei_bootstrap_incomplete"],
      errorCode: "youtubei_bootstrap_incomplete",
      errorMessage: "The watch page did not expose enough youtubei metadata for transcript reconstruction.",
      pageData
    };
  }

  if (!transcriptParams) {
    return {
      ok: false,
      warnings: ["youtubei_params_missing"],
      errorCode: "youtubei_params_missing",
      errorMessage: "The watch page did not expose transcript params for youtubei transcript reconstruction.",
      pageData
    };
  }

  const response = await options.fetchImpl(
    `https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false&key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-youtube-client-name": String(clientName),
        "x-youtube-client-version": String(clientVersion)
      },
      signal: options.signal,
      body: JSON.stringify({
        context: clientContext,
        params: transcriptParams
      })
    }
  );

  if (!response.ok) {
    const failure = await readYoutubeiFailure(response);
    return {
      ok: false,
      warnings: failure.warnings,
      errorCode: failure.errorCode,
      errorMessage: failure.errorMessage,
      pageData
    };
  }

  const payload = await response.json();
  const parsed = parseYoutubeiTranscript(payload);
  if (!parsed.text) {
    return {
      ok: false,
      warnings: ["youtubei_empty"],
      errorCode: "youtubei_empty",
      errorMessage: "The youtubei transcript response contained no usable transcript text.",
      pageData
    };
  }

  return {
    ok: true,
    warnings: [],
    pageData,
    payload: buildSuccessPayload({
      text: parsed.text,
      segments: parsed.segments,
      sourceLabel: "Backend YouTube transcript",
      sourceConfidence: "medium",
      warnings: ["backend_youtubei_resolver", "youtubei_request_shape_pending_validation"],
      languageCode: normalizeLanguage(parsed.languageCode),
      originalLanguageCode: normalizeLanguage(
        parsed.originalLanguageCode || parsed.languageCode
      ),
      isGenerated: parsed.isGenerated,
      isTranslated: parsed.isTranslated,
      isMachineTranslated: parsed.isMachineTranslated,
      videoDurationSeconds: pageData.videoDurationSeconds || parsed.videoDurationSeconds || null
    })
  };
}

async function resolveFromYtDlp(request, options) {
  const pageData = options.pageData || {};

  if (typeof options.ytDlpResolver === "function") {
    const override = await options.ytDlpResolver({
      request,
      pageData,
      signal: options.signal
    });
    if (!override?.ok) {
      return {
        ok: false,
        warnings: dedupeList([]
          .concat(override?.warnings || [])
          .concat(["yt_dlp_failed"])),
        errorCode: override?.errorCode || "yt_dlp_failed",
        errorMessage: override?.errorMessage || "The yt-dlp transcript fallback failed.",
        pageData
      };
    }

    return {
      ok: true,
      warnings: [],
      pageData,
      payload: buildSuccessPayload({
        ...override,
        sourceLabel: override.sourceLabel || "Backend yt-dlp transcript",
        sourceConfidence: override.sourceConfidence || "medium",
        warnings: []
          .concat(override.warnings || [])
          .concat(["backend_yt_dlp_fallback"]),
        videoDurationSeconds:
          pageData.videoDurationSeconds || override.videoDurationSeconds || null
      })
    };
  }

  const commandConfig = resolveYtDlpCommandConfig(options);
  if (!commandConfig) {
    return {
      ok: false,
      warnings: ["yt_dlp_not_configured"],
      pageData
    };
  }

  const downloaded = await runYtDlpCommand(request, {
    signal: options.signal,
    commandConfig
  });

  if (!downloaded.ok) {
    return {
      ok: false,
      warnings: downloaded.warnings || ["yt_dlp_failed"],
      errorCode: downloaded.errorCode || "yt_dlp_failed",
      errorMessage: downloaded.errorMessage || "The yt-dlp transcript fallback failed.",
      pageData
    };
  }

  return {
    ok: true,
    warnings: [],
    pageData,
    payload: buildSuccessPayload({
      text: downloaded.text,
      segments: downloaded.segments,
      sourceLabel: "Backend yt-dlp captions",
      sourceConfidence: "medium",
      warnings: []
        .concat(downloaded.warnings || [])
        .concat(["backend_yt_dlp_fallback"]),
      languageCode: normalizeLanguage(
        downloaded.languageCode || request.requestedLanguageCode || "en"
      ),
      originalLanguageCode: normalizeLanguage(
        downloaded.originalLanguageCode ||
          downloaded.languageCode ||
          request.requestedLanguageCode ||
          "en"
      ),
      isGenerated:
        typeof downloaded.isGenerated === "boolean" ? downloaded.isGenerated : null,
      videoDurationSeconds: pageData.videoDurationSeconds || null
    })
  };
}

async function resolveFromHeadless(request, options) {
  if (typeof options.headlessResolver === "function") {
    const override = await options.headlessResolver({
      request,
      pageData: options.pageData || {},
      signal: options.signal
    });
    if (!override?.ok) {
      return {
        ok: false,
        warnings: dedupeList([]
          .concat(override?.warnings || [])
          .concat(["backend_headless_failed"])),
        errorCode: override?.errorCode || "backend_headless_failed",
        errorMessage: override?.errorMessage || "The headless transcript fallback failed.",
        pageData: options.pageData || {}
      };
    }

    return {
      ok: true,
      warnings: [],
      pageData: options.pageData || {},
      payload: buildSuccessPayload({
        ...override,
        sourceLabel: override.sourceLabel || "Headless transcript panel",
        sourceConfidence: override.sourceConfidence || "medium",
        warnings: []
          .concat(override.warnings || [])
          .concat(["backend_headless_fallback"])
      })
    };
  }

  const browser = await options.chromiumLauncher.launch({ headless: true });
  let context = null;
  const cleanupAbort = attachBrowserAbort(options.signal, browser);

  try {
    context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1440, height: 1100 },
      userAgent: WATCH_PAGE_HEADERS["user-agent"]
    });

    const page = await context.newPage();
    await page.goto(request.url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await maybeAcceptConsent(page);
    await page.waitForTimeout(1200);

    const opened = await openTranscriptPanel(page);
    if (!opened) {
      return {
        ok: false,
        warnings: ["backend_headless_failed"],
        errorCode: "backend_headless_failed",
        errorMessage: "The headless browser could not open the YouTube transcript panel.",
        pageData: options.pageData || {}
      };
    }

    await page.waitForFunction(() => {
      return document.querySelectorAll("ytd-transcript-segment-renderer").length > 0;
    }, { timeout: 2500 });

    const extracted = await page.evaluate(() => {
      const sanitize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const parseTimeLabel = (value) => {
        const text = sanitize(value);
        if (!text) {
          return null;
        }
        const parts = text.split(":").map((part) => Number(part));
        if (parts.some((part) => !Number.isFinite(part))) {
          return null;
        }
        let seconds = 0;
        while (parts.length) {
          seconds = seconds * 60 + parts.shift();
        }
        return seconds * 1000;
      };

      const nodes = Array.from(document.querySelectorAll("ytd-transcript-segment-renderer"));
      const segments = nodes
        .map((node) => {
          const text =
            sanitize(
              node.querySelector("#segment-text")?.textContent ||
                node.querySelector(".segment-text")?.textContent ||
                node.textContent ||
                ""
            );
          if (!text) {
            return null;
          }

          const timeLabel =
            node.querySelector("#segment-timestamp")?.textContent ||
            node.querySelector(".segment-timestamp")?.textContent ||
            "";

          return {
            startMs: parseTimeLabel(timeLabel),
            durationMs: null,
            text
          };
        })
        .filter(Boolean);

      for (let index = 0; index < segments.length - 1; index += 1) {
        const current = segments[index];
        const next = segments[index + 1];
        if (typeof current.startMs === "number" && typeof next.startMs === "number") {
          current.durationMs = Math.max(0, next.startMs - current.startMs);
        }
      }

      const videoDurationSeconds = Number(
        globalThis.ytInitialPlayerResponse?.videoDetails?.lengthSeconds ||
          globalThis.ytplayer?.config?.args?.length_seconds ||
          0
      ) || null;

      return {
        text: sanitize(segments.map((segment) => segment.text).join("\n")),
        segments,
        languageCode: sanitize(document.documentElement.lang || "") || null,
        videoDurationSeconds
      };
    });

    if (!extracted?.text) {
      return {
        ok: false,
        warnings: ["backend_headless_failed"],
        errorCode: "backend_headless_failed",
        errorMessage: "The transcript panel opened, but no transcript segments were rendered.",
        pageData: options.pageData || {}
      };
    }

    return {
      ok: true,
      warnings: [],
      pageData: {
        ...(options.pageData || {}),
        videoDurationSeconds:
          options.pageData?.videoDurationSeconds || extracted.videoDurationSeconds || null
      },
      payload: buildSuccessPayload({
        text: extracted.text,
        segments: extracted.segments,
        sourceLabel: "Headless transcript panel",
        sourceConfidence: "medium",
        warnings: ["backend_headless_fallback"],
        languageCode: normalizeLanguage(extracted.languageCode),
        originalLanguageCode: normalizeLanguage(extracted.languageCode),
        isGenerated: null,
        isTranslated: false,
        isMachineTranslated: false,
        videoDurationSeconds:
          options.pageData?.videoDurationSeconds || extracted.videoDurationSeconds || null
      })
    };
  } finally {
    cleanupAbort();
    if (context) {
      await context.close().catch(() => {});
    }
    await browser.close().catch(() => {});
  }
}

function buildSuccessPayload(input) {
  const segments = normalizeSegments(input.segments || []);
  const text = sanitizeText(input.text || segments.map((segment) => segment.text).join("\n"));
  const videoDurationSeconds = toFiniteNumber(input.videoDurationSeconds);
  const transcriptSpanSeconds =
    toFiniteNumber(input.transcriptSpanSeconds) || computeTranscriptSpanSeconds(segments);
  const coverageRatio = computeCoverageRatio({
    segmentCount: segments.length,
    text,
    transcriptSpanSeconds,
    videoDurationSeconds
  });
  const segmentQualityScore =
    toFiniteNumber(input.segmentQualityScore) || computeSegmentQualityScore(segments);
  const quality = deriveQuality({
    text,
    sourceConfidence: input.sourceConfidence,
    transcriptSpanSeconds,
    coverageRatio,
    segmentQualityScore
  });

  return {
    ok: true,
    providerClass: "backend",
    strategy: "backend-transcript",
    sourceLabel: input.sourceLabel || "Backend transcript",
    sourceConfidence: normalizeConfidence(input.sourceConfidence) || "medium",
    quality,
    languageCode: normalizeLanguage(input.languageCode),
    originalLanguageCode: normalizeLanguage(
      input.originalLanguageCode || input.languageCode
    ),
    isGenerated: typeof input.isGenerated === "boolean" ? input.isGenerated : null,
    isTranslated: Boolean(input.isTranslated),
    isMachineTranslated: Boolean(input.isMachineTranslated),
    coverageRatio,
    transcriptSpanSeconds,
    videoDurationSeconds,
    segmentQualityScore,
    warnings: dedupeList(input.warnings || []),
    segments,
    text
  };
}

function buildFailurePayload(input) {
  return {
    ok: false,
    providerClass: "backend",
    sourceLabel: "Backend transcript unavailable",
    sourceConfidence: "low",
    quality: "enhanced-extraction-unavailable",
    languageCode: null,
    originalLanguageCode: null,
    isGenerated: null,
    coverageRatio: null,
    transcriptSpanSeconds: null,
    videoDurationSeconds: toFiniteNumber(input.videoDurationSeconds),
    warnings: dedupeList(input.warnings || []),
    errorCode: input.errorCode || "backend_transcript_unavailable",
    errorMessage:
      input.errorMessage || "No transcript-class source was available for this video.",
    segments: [],
    text: ""
  };
}

function chooseBestBackendResult(current, next) {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }

  const currentQualityRank = qualityRank(current.quality);
  const nextQualityRank = qualityRank(next.quality);
  if (nextQualityRank !== currentQualityRank) {
    return nextQualityRank > currentQualityRank ? next : current;
  }

  const currentConfidenceRank = confidenceRank(current.sourceConfidence);
  const nextConfidenceRank = confidenceRank(next.sourceConfidence);
  if (nextConfidenceRank !== currentConfidenceRank) {
    return nextConfidenceRank > currentConfidenceRank ? next : current;
  }

  const currentCoverage = toFiniteNumber(current.coverageRatio) || 0;
  const nextCoverage = toFiniteNumber(next.coverageRatio) || 0;
  if (Math.abs(currentCoverage - nextCoverage) >= 0.05) {
    return nextCoverage > currentCoverage ? next : current;
  }

  const currentSpan = toFiniteNumber(current.transcriptSpanSeconds) || 0;
  const nextSpan = toFiniteNumber(next.transcriptSpanSeconds) || 0;
  if (Math.abs(currentSpan - nextSpan) >= 20) {
    return nextSpan > currentSpan ? next : current;
  }

  return (toFiniteNumber(next.segmentQualityScore) || 0) >
    (toFiniteNumber(current.segmentQualityScore) || 0)
    ? next
    : current;
}

function isStrongTranscript(result) {
  return result?.quality === "strong-transcript";
}

async function fetchCaptionTrack(baseUrl, options) {
  const urls = buildCaptionAttemptUrls(baseUrl);

  for (const attemptUrl of urls) {
    const response = await options.fetchImpl(attemptUrl, {
      method: "GET",
      headers: {
        "accept-language": "en-US,en;q=0.9"
      },
      signal: options.signal
    }).catch(() => null);

    if (!response?.ok) {
      continue;
    }

    const payloadText = await response.text().catch(() => "");
    const parsed = parseCaptionPayload(payloadText);
    if (parsed.text) {
      return parsed;
    }
  }

  return {
    text: "",
    segments: []
  };
}

function buildCaptionAttemptUrls(baseUrl) {
  const results = [];
  const seen = new Set();
  const pushValue = (value) => {
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    results.push(value);
  };

  pushValue(baseUrl);

  try {
    const url = new URL(baseUrl);
    ["json3", "srv3", "vtt"].forEach((format) => {
      const nextUrl = new URL(url.toString());
      nextUrl.searchParams.set("fmt", format);
      pushValue(nextUrl.toString());
    });
  } catch (error) {
    return results;
  }

  return results;
}

function resolveYtDlpCommandConfig(options) {
  const directCommand = options.ytDlpCommand || process.env.SCRIPTLENS_YTDLP_COMMAND;
  if (Array.isArray(directCommand) && directCommand.length) {
    return {
      command: String(directCommand[0]),
      prefixArgs: directCommand.slice(1).map((value) => String(value)),
      env: process.env
    };
  }
  if (typeof directCommand === "string" && directCommand.trim()) {
    return {
      command: directCommand.trim(),
      prefixArgs: [],
      env: process.env
    };
  }

  const pythonPath = options.ytDlpPythonPath || process.env.SCRIPTLENS_YTDLP_PYTHONPATH;
  if (typeof pythonPath === "string" && pythonPath.trim()) {
    return {
      command:
        String(
          options.ytDlpPythonCommand ||
            process.env.SCRIPTLENS_YTDLP_PYTHON ||
            "python"
        ).trim() || "python",
      prefixArgs: ["-m", "yt_dlp"],
      env: {
        ...process.env,
        PYTHONPATH: pythonPath.trim()
      }
    };
  }

  return null;
}

async function runYtDlpCommand(request, options) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scriptlens-ytdlp-"));

  try {
    const args = []
      .concat(options.commandConfig.prefixArgs || [])
      .concat([
        "--skip-download",
        "--write-subs",
        "--write-auto-sub",
        "--sub-format",
        "json3",
        "--sub-langs",
        buildYtDlpLanguageSpec(request.requestedLanguageCode),
        "-o",
        path.join(tempDir, "%(id)s.%(ext)s"),
        request.url
      ]);

    const executed = await spawnProcess({
      command: options.commandConfig.command,
      args,
      env: options.commandConfig.env || process.env,
      signal: options.signal
    });

    if (executed.code !== 0) {
      return {
        ok: false,
        warnings: ["yt_dlp_failed"],
        errorCode: "yt_dlp_failed",
        errorMessage: readProcessFailureMessage(executed.stderr, executed.stdout)
      };
    }

    const subtitlePath = await findPreferredSubtitlePath(
      tempDir,
      request.requestedLanguageCode
    );
    if (!subtitlePath) {
      return {
        ok: false,
        warnings: ["yt_dlp_empty"],
        errorCode: "yt_dlp_empty",
        errorMessage: "yt-dlp completed, but no subtitle payload was written."
      };
    }

    const payloadText = await fs.readFile(subtitlePath, "utf8");
    const parsed = parseCaptionPayload(payloadText);
    if (!parsed.text) {
      return {
        ok: false,
        warnings: ["yt_dlp_empty"],
        errorCode: "yt_dlp_empty",
        errorMessage: "yt-dlp wrote a subtitle file, but it contained no usable text."
      };
    }

    return {
      ok: true,
      text: parsed.text,
      segments: parsed.segments,
      languageCode:
        inferLanguageFromSubtitlePath(subtitlePath) || request.requestedLanguageCode || "en",
      warnings: ["backend_yt_dlp_resolver"]
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function buildYtDlpLanguageSpec(requestedLanguageCode) {
  const normalized = normalizeLanguage(requestedLanguageCode || "en") || "en";
  const requestedBase = normalized.split("-")[0];
  return dedupeList([
    normalized,
    `${requestedBase}-orig`,
    requestedBase,
    "en-orig",
    "en"
  ]).join(",");
}

function findPreferredSubtitlePath(tempDir, requestedLanguageCode) {
  return fs.readdir(tempDir).then((entries) => {
    const subtitleFiles = entries
      .filter((entry) => /\.json3$/i.test(entry))
      .sort((left, right) =>
        scoreSubtitleFile(right, requestedLanguageCode) -
        scoreSubtitleFile(left, requestedLanguageCode)
      );

    if (!subtitleFiles.length) {
      return null;
    }

    return path.join(tempDir, subtitleFiles[0]);
  });
}

function scoreSubtitleFile(filename, requestedLanguageCode) {
  const lowerName = String(filename || "").toLowerCase();
  const requested = normalizeLanguage(requestedLanguageCode || "");
  const requestedBase = requested ? requested.split("-")[0] : "";

  if (requested && lowerName.endsWith(`.${requested.toLowerCase()}.json3`)) {
    return 5;
  }
  if (
    requestedBase &&
    lowerName.endsWith(`.${requestedBase.toLowerCase()}-orig.json3`)
  ) {
    return 4;
  }
  if (requestedBase && lowerName.endsWith(`.${requestedBase.toLowerCase()}.json3`)) {
    return 3;
  }
  if (lowerName.endsWith(".en-orig.json3")) {
    return 2;
  }
  if (lowerName.endsWith(".en.json3")) {
    return 1;
  }
  return 0;
}

function inferLanguageFromSubtitlePath(filePath) {
  const match = String(filePath || "").match(/\.([a-z]{2,3}(?:-[a-z0-9]+)?)\.json3$/i);
  return normalizeLanguage(match?.[1] || null);
}

function spawnProcess(options) {
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args || [], {
      env: options.env || process.env,
      windowsHide: true
    });
    const stdout = [];
    const stderr = [];
    let settled = false;

    const cleanupAbort = attachProcessAbort(options.signal, child, () => {
      if (!settled) {
        settled = true;
        reject(new Error("timeout"));
      }
    });

    child.stdout?.on("data", (chunk) => stdout.push(String(chunk || "")));
    child.stderr?.on("data", (chunk) => stderr.push(String(chunk || "")));
    child.once("error", (error) => {
      cleanupAbort();
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (code) => {
      cleanupAbort();
      if (!settled) {
        settled = true;
        resolve({
          code: Number.isFinite(code) ? code : 0,
          stdout: stdout.join(""),
          stderr: stderr.join("")
        });
      }
    });
  });
}

function attachProcessAbort(signal, child, onAbort) {
  if (!signal) {
    return () => {};
  }

  const abort = () => {
    child.kill();
    if (typeof onAbort === "function") {
      onAbort();
    }
  };

  if (signal.aborted) {
    abort();
    return () => {};
  }

  signal.addEventListener("abort", abort, { once: true });
  return () => {
    signal.removeEventListener("abort", abort);
  };
}

function readProcessFailureMessage(stderr, stdout) {
  const source = sanitizeText(String(stderr || stdout || ""));
  if (!source) {
    return "The yt-dlp transcript fallback failed.";
  }

  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(-3).join(" ");
}

function parseCaptionPayload(source) {
  const text = String(source || "").trim();
  if (!text) {
    return { text: "", segments: [] };
  }
  if (text.startsWith("{")) {
    return parseJsonCaptionPayload(text);
  }
  if (text.startsWith("WEBVTT")) {
    return parseVttCaptionPayload(text);
  }
  return parseXmlCaptionPayload(text);
}

function parseJsonCaptionPayload(source) {
  try {
    const parsed = JSON.parse(source);
    const segments = (parsed?.events || [])
      .map((event) => {
        const text = sanitizeText(
          ((event?.segs || [])
            .map((part) => decodeEntities(part?.utf8 || ""))
            .join(""))
        );

        if (!text) {
          return null;
        }

        return {
          startMs: toFiniteNumber(event?.tStartMs),
          durationMs: toFiniteNumber(event?.dDurationMs),
          text
        };
      })
      .filter(Boolean);
    return finalizeCaptionSegments(segments);
  } catch (error) {
    return { text: "", segments: [] };
  }
}

function parseXmlCaptionPayload(source) {
  const pattern = /<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const segments = [];
  let match = null;

  while ((match = pattern.exec(source))) {
    const text = sanitizeText(decodeEntities(stripHtml(match[3] || "")));
    if (!text) {
      continue;
    }
    segments.push({
      startMs: parseAttributeTime(match[2], ["t", "start", "begin"]),
      durationMs: parseAttributeTime(match[2], ["d", "dur"]),
      text
    });
  }

  return finalizeCaptionSegments(segments);
}

function parseVttCaptionPayload(source) {
  const lines = String(source || "").split(/\r?\n/);
  const segments = [];
  let currentCue = null;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentCue?.text) {
        segments.push(currentCue);
      }
      currentCue = null;
      return;
    }

    if (trimmed === "WEBVTT" || /^\d+$/.test(trimmed) || /^(NOTE|STYLE|REGION)\b/.test(trimmed)) {
      return;
    }

    const timing = trimmed.match(
      /^((?:\d{2}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}\.\d{3})/
    );
    if (timing) {
      currentCue = {
        startMs: parseVttTime(timing[1]),
        durationMs: Math.max(0, parseVttTime(timing[2]) - parseVttTime(timing[1])),
        text: ""
      };
      return;
    }

    if (!currentCue) {
      return;
    }

    currentCue.text = sanitizeText(
      [currentCue.text, decodeEntities(stripHtml(trimmed))].filter(Boolean).join(" ")
    );
  });

  if (currentCue?.text) {
    segments.push(currentCue);
  }

  return finalizeCaptionSegments(segments);
}

function finalizeCaptionSegments(segments) {
  const normalized = normalizeSegments(segments);
  return {
    text: sanitizeText(normalized.map((segment) => segment.text).join("\n")),
    segments: normalized
  };
}

function pickPreferredTrack(tracks, requestedLanguageCode) {
  const normalizedTracks = (Array.isArray(tracks) ? tracks : []).map((track) => ({
    ...track,
    languageCode: normalizeLanguage(track.languageCode)
  }));
  const requested = normalizeLanguage(requestedLanguageCode);
  const manualTracks = normalizedTracks.filter((track) => track.kind !== "asr");
  const generatedTracks = normalizedTracks.filter((track) => track.kind === "asr");
  const requestedManual = manualTracks.find((track) => languageMatches(track.languageCode, requested));
  const requestedGenerated = generatedTracks.find((track) =>
    languageMatches(track.languageCode, requested)
  );
  const englishManual = manualTracks.find((track) => languageMatches(track.languageCode, "en"));
  const englishGenerated = generatedTracks.find((track) =>
    languageMatches(track.languageCode, "en")
  );

  return (
    requestedManual ||
    requestedGenerated ||
    englishManual ||
    englishGenerated ||
    manualTracks[0] ||
    generatedTracks[0] ||
    null
  );
}

function readCaptionTracks(playerResponse) {
  return Array.isArray(
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks
  )
    ? playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks
    : [];
}

function readInnertubeValue(pageData, key) {
  return (
    pageData?.ytcfg?.[key] ||
    pageData?.ytcfg?.WEB_PLAYER_CONTEXT_CONFIGS?.WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH?.[key] ||
    null
  );
}

function readClientContext(pageData, clientName, clientVersion) {
  if (pageData?.ytcfg?.INNERTUBE_CONTEXT?.client) {
    return pageData.ytcfg.INNERTUBE_CONTEXT;
  }

  if (!clientName || !clientVersion) {
    return null;
  }

  return {
    client: {
      clientName,
      clientVersion,
      hl: "en",
      gl: "US"
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

    Object.keys(current).forEach((key) => {
      const value = current[key];
      if (value && typeof value === "object") {
        queue.push(value);
      }
    });
  }

  return "";
}

async function readYoutubeiFailure(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  const descriptor = `${response.status} ${payload?.error?.message || payload?.error?.status || ""}`.toUpperCase();
  if (descriptor.includes("FAILED_PRECONDITION")) {
    return {
      warnings: ["youtubei_failed_precondition"],
      errorCode: "youtubei_failed_precondition",
      errorMessage: "The reconstructed youtubei transcript request failed a precondition check."
    };
  }

  return {
    warnings: ["youtubei_failed"],
    errorCode: `youtubei_http_${response.status}`,
    errorMessage: `The youtubei transcript endpoint returned ${response.status}.`
  };
}

function parseYoutubeiTranscript(payload) {
  const segments = [];
  collectTranscriptRenderers(payload, segments);
  const normalizedSegments = normalizeSegments(segments);

  return {
    text: sanitizeText(normalizedSegments.map((segment) => segment.text).join("\n")),
    segments: normalizedSegments,
    languageCode: findFirstScalar(payload, "languageCode"),
    originalLanguageCode: findFirstScalar(payload, "originalLanguageCode"),
    isGenerated: findFirstScalar(payload, "kind") === "asr",
    isTranslated: Boolean(findFirstScalar(payload, "isTranslated")),
    isMachineTranslated: Boolean(findFirstScalar(payload, "isMachineTranslated")),
    videoDurationSeconds: null
  };
}

function collectTranscriptRenderers(node, output) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (node.transcriptSegmentRenderer || node.transcriptCueRenderer) {
    const renderer = node.transcriptSegmentRenderer || node.transcriptCueRenderer;
    const text = sanitizeText(readRunsText(renderer.snippet) || readRunsText(renderer.cue));
    if (text) {
      output.push({
        startMs:
          toFiniteNumber(renderer.startMs) ||
          parseTimestampLabel(readRunsText(renderer.startTimeText)) ||
          parseTimestampLabel(readRunsText(renderer.startOffsetText)),
        durationMs: toFiniteNumber(renderer.durationMs),
        text
      });
    }
  }

  Object.keys(node).forEach((key) => {
    const value = node[key];
    if (Array.isArray(value)) {
      value.forEach((entry) => collectTranscriptRenderers(entry, output));
      return;
    }
    if (value && typeof value === "object") {
      collectTranscriptRenderers(value, output);
    }
  });
}

function findFirstScalar(node, keyName) {
  const queue = [node];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (Object.prototype.hasOwnProperty.call(current, keyName)) {
      return current[keyName];
    }

    Object.keys(current).forEach((key) => {
      const value = current[key];
      if (value && typeof value === "object") {
        queue.push(value);
      }
    });
  }

  return null;
}

async function maybeAcceptConsent(page) {
  const buttons = [
    page.getByRole("button", { name: /Accept all/i }),
    page.getByRole("button", { name: /I agree/i })
  ];

  for (const locator of buttons) {
    if (await locator.count().catch(() => 0)) {
      await locator.first().click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(400);
      return;
    }
  }
}

async function openTranscriptPanel(page) {
  const directSelectors = [
    "button[aria-label*='transcript' i]",
    "button[title*='transcript' i]",
    "ytd-video-description-transcript-section-renderer button"
  ];

  for (const selector of directSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      await locator.click({ timeout: 1000 }).catch(() => {});
      if (await waitForTranscriptSegments(page, 1400)) {
        return true;
      }
    }
  }

  const textLocators = [
    page.getByRole("button", { name: /transcript/i }),
    page.locator("ytd-button-renderer, tp-yt-paper-button, yt-formatted-string").filter({
      hasText: /transcript/i
    })
  ];

  for (const locator of textLocators) {
    if (await locator.count().catch(() => 0)) {
      await locator.first().click({ timeout: 1000 }).catch(() => {});
      if (await waitForTranscriptSegments(page, 1400)) {
        return true;
      }
    }
  }

  const moreActions = [
    page.locator("ytd-menu-renderer button[aria-label*='more' i]").first(),
    page.locator("button[aria-label*='more actions' i]").first(),
    page.locator("button[aria-label='Action menu']").first(),
    page.locator("button[aria-haspopup='true'][aria-label]").first()
  ];

  for (const locator of moreActions) {
    if (await locator.count().catch(() => 0)) {
      await locator.click({ timeout: 1000 }).catch(() => {});
      const menuItem = page
        .locator("ytd-menu-service-item-renderer, tp-yt-paper-item, yt-formatted-string, button")
        .filter({ hasText: /transcript/i })
        .first();
      if (await menuItem.count().catch(() => 0)) {
        await menuItem.click({ timeout: 1000 }).catch(() => {});
        if (await waitForTranscriptSegments(page, 1600)) {
          return true;
        }
      }
    }
  }

  return waitForTranscriptSegments(page, 500);
}

async function waitForTranscriptSegments(page, timeoutMs) {
  try {
    await page.waitForFunction(() => {
      return document.querySelectorAll("ytd-transcript-segment-renderer").length > 0;
    }, { timeout: timeoutMs });
    return true;
  } catch (error) {
    return false;
  }
}

function extractAssignedObject(source, markers) {
  const text = String(source || "");

  for (const marker of markers) {
    const index = text.indexOf(marker);
    if (index === -1) {
      continue;
    }

    const braceIndex = text.indexOf("{", index + marker.length);
    if (braceIndex === -1) {
      continue;
    }

    const objectText = extractJsonLikeObject(text, braceIndex);
    if (!objectText) {
      continue;
    }

    try {
      return JSON.parse(objectText);
    } catch (error) {
      continue;
    }
  }

  return null;
}

function extractYtcfg(source) {
  const text = String(source || "");
  const result = {};
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const markerIndex = text.indexOf("ytcfg.set(", searchFrom);
    if (markerIndex === -1) {
      break;
    }

    const braceIndex = text.indexOf("{", markerIndex);
    if (braceIndex === -1) {
      break;
    }

    const objectText = extractJsonLikeObject(text, braceIndex);
    if (!objectText) {
      searchFrom = markerIndex + 8;
      continue;
    }

    try {
      Object.assign(result, JSON.parse(objectText));
    } catch (error) {
      // Ignore invalid config fragments and keep walking.
    }

    searchFrom = braceIndex + objectText.length;
  }

  return result;
}

function extractJsonLikeObject(source, startIndex) {
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString) {
      if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return "";
}

function normalizeRequest(input) {
  const url = normalizeWatchUrl(input?.url, input?.videoId);
  const videoId = normalizeVideoId(input?.videoId || extractVideoId(url));
  return {
    url,
    videoId,
    requestedLanguageCode: normalizeLanguage(input?.requestedLanguageCode),
    includeTimestamps: input?.includeTimestamps !== false
  };
}

function normalizeWatchUrl(url, videoId) {
  const safeUrl = String(url || "").trim();
  if (safeUrl) {
    try {
      const parsed = new URL(safeUrl);
      if (parsed.pathname === "/watch" && parsed.searchParams.get("v")) {
        return `https://www.youtube.com/watch?v=${parsed.searchParams.get("v")}`;
      }
      const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?#]+)/);
      if (shortsMatch) {
        return `https://www.youtube.com/watch?v=${shortsMatch[1]}`;
      }
    } catch (error) {
      // Fall through to the explicit video ID path.
    }
  }

  const normalizedVideoId = normalizeVideoId(videoId);
  return normalizedVideoId
    ? `https://www.youtube.com/watch?v=${normalizedVideoId}`
    : "";
}

function extractVideoId(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.pathname === "/watch") {
      return parsed.searchParams.get("v") || "";
    }
    const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?#]+)/);
    return shortsMatch ? shortsMatch[1] : "";
  } catch (error) {
    return "";
  }
}

function normalizeVideoId(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_-]{6,}$/.test(text) ? text : "";
}

function normalizeSegments(segments) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => ({
      startMs: toFiniteNumber(segment?.startMs),
      durationMs: toFiniteNumber(segment?.durationMs),
      text: sanitizeText(segment?.text || "")
    }))
    .filter((segment) => Boolean(segment.text));
}

function computeCoverageRatio(input) {
  if (isFiniteNumber(input.transcriptSpanSeconds) && isFiniteNumber(input.videoDurationSeconds)) {
    return roundTo(
      clamp(input.transcriptSpanSeconds / Math.max(1, input.videoDurationSeconds), 0, 1),
      3
    );
  }

  if (input.segmentCount > 0) {
    return roundTo(
      clamp(Math.max(input.segmentCount / 48, countWords(input.text) / 900), 0, 1),
      3
    );
  }

  return null;
}

function computeTranscriptSpanSeconds(segments) {
  const withTimestamps = segments.filter((segment) => isFiniteNumber(segment.startMs));
  if (!withTimestamps.length) {
    return null;
  }

  const startMs = Math.min(...withTimestamps.map((segment) => segment.startMs));
  const endMs = Math.max(
    ...withTimestamps.map((segment) => segment.startMs + Math.max(segment.durationMs || 0, 0))
  );

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }

  return roundTo((endMs - startMs) / 1000, 1);
}

function computeSegmentQualityScore(segments) {
  if (!segments.length) {
    return 0;
  }

  const timestampRatio =
    segments.filter((segment) => isFiniteNumber(segment.startMs)).length / segments.length;
  const avgWords = average(
    segments.map((segment) => Math.max(1, countWords(segment.text || "")))
  );
  const nearEmptyRatio =
    segments.filter((segment) => countWords(segment.text || "") <= 1).length / segments.length;
  const monotonicity = computeMonotonicity(segments);
  const countScore = normalizeRange(segments.length, 4, 48) * 25;
  const timestampScore = timestampRatio * 30;
  const continuityScore = monotonicity * 15;
  const densityScore = Math.max(0, 20 - Math.abs(avgWords - 10) * 2);
  const emptyPenalty = nearEmptyRatio * 20;

  return Math.round(clamp(countScore + timestampScore + continuityScore + densityScore - emptyPenalty, 0, 100));
}

function computeMonotonicity(segments) {
  const values = segments.map((segment) => segment.startMs).filter(isFiniteNumber);
  if (values.length <= 1) {
    return 0;
  }

  let monotonicPairs = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] >= values[index - 1]) {
      monotonicPairs += 1;
    }
  }

  return monotonicPairs / Math.max(1, values.length - 1);
}

function deriveQuality(input) {
  if (!input.text) {
    return "enhanced-extraction-unavailable";
  }

  if (
    normalizeConfidence(input.sourceConfidence) === "high" &&
    (((input.coverageRatio || 0) >= 0.45) || ((input.transcriptSpanSeconds || 0) >= 120)) &&
    (input.segmentQualityScore || 0) >= 60
  ) {
    return "strong-transcript";
  }

  return "partial-transcript";
}

function readRunsText(value) {
  if (!value) {
    return "";
  }
  if (typeof value.simpleText === "string") {
    return value.simpleText;
  }
  if (Array.isArray(value.runs)) {
    return value.runs.map((part) => part.text || "").join("");
  }
  return "";
}

function parseTimestampLabel(value) {
  const text = sanitizeText(value);
  if (!text) {
    return null;
  }
  const parts = text.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  let seconds = 0;
  while (parts.length) {
    seconds = seconds * 60 + parts.shift();
  }
  return seconds * 1000;
}

function parseAttributeTime(attributes, names) {
  const source = String(attributes || "");
  for (const name of names) {
    const match = source.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
    if (!match) {
      continue;
    }
    const parsed = parseTimeValue(match[1]);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function parseTimeValue(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  if (/^\d+(?:\.\d+)?ms$/i.test(text)) {
    return Number.parseFloat(text);
  }
  if (/^\d+(?:\.\d+)?s$/i.test(text)) {
    return Number.parseFloat(text) * 1000;
  }
  if (/^\d+$/.test(text)) {
    return Number(text);
  }
  if (/^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(text) || /^\d{2}:\d{2}\.\d{3}$/.test(text)) {
    return parseVttTime(text);
  }
  return null;
}

function parseVttTime(value) {
  const parts = String(value || "").split(":").map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  const secondsPart = parts.pop();
  const minutesPart = parts.pop();
  const hoursPart = parts.pop() || "0";
  const [seconds, millis] = secondsPart.split(".");

  return (
    Number(hoursPart) * 60 * 60 * 1000 +
    Number(minutesPart) * 60 * 1000 +
    Number(seconds || 0) * 1000 +
    Number(millis || 0)
  );
}

function sanitizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function countWords(value) {
  const text = sanitizeText(value);
  return text ? text.split(/\s+/).length : 0;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code) || 0))
    .replace(/\u00a0/g, " ");
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ");
}

function normalizeLanguage(value) {
  const text = String(value || "").trim().toLowerCase();
  return text || null;
}

function normalizeConfidence(value) {
  const text = String(value || "").trim().toLowerCase();
  return text === "high" || text === "medium" || text === "low" ? text : null;
}

function confidenceRank(value) {
  if (value === "high") {
    return 3;
  }
  if (value === "medium") {
    return 2;
  }
  if (value === "low") {
    return 1;
  }
  return 0;
}

function qualityRank(value) {
  if (value === "strong-transcript") {
    return 3;
  }
  if (value === "partial-transcript") {
    return 2;
  }
  if (value === "weak-fallback") {
    return 1;
  }
  return 0;
}

function languageMatches(value, target) {
  if (!value || !target) {
    return false;
  }
  return value === target || value.startsWith(`${target}-`);
}

function average(values) {
  if (!Array.isArray(values) || !values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeRange(value, min, max) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return clamp((value - min) / Math.max(1, max - min), 0, 1);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return clamp(number, min, max);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundTo(value, precision) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function dedupeList(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).filter((value) => {
    const key = String(value || "");
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function linkAbortSignal(parentSignal, controller) {
  if (!parentSignal) {
    return () => {};
  }

  const onAbort = () => {
    controller.abort(parentSignal.reason);
  };

  if (parentSignal.aborted) {
    onAbort();
    return () => {};
  }

  parentSignal.addEventListener("abort", onAbort, { once: true });
  return () => parentSignal.removeEventListener("abort", onAbort);
}

function attachBrowserAbort(signal, browser) {
  if (!signal) {
    return () => {};
  }

  const onAbort = () => {
    browser.close().catch(() => {});
  };

  if (signal.aborted) {
    onAbort();
    return () => {};
  }

  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

function createAbortTimeout(controller, timeoutMs) {
  return setTimeout(() => {
    controller.abort(new Error("timeout"));
  }, timeoutMs);
}

function waitForAbort(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason || new Error("aborted"));
      return;
    }

    signal.addEventListener(
      "abort",
      () => reject(signal.reason || new Error("aborted")),
      { once: true }
    );
  });
}
