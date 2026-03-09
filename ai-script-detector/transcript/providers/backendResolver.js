(function (root) {
  const ScriptLens = (root.ScriptLens = root.ScriptLens || {});
  const Transcript = (ScriptLens.transcript = ScriptLens.transcript || {});
  const Providers = (Transcript.providers = Transcript.providers || {});
  const Debug = root.ScriptLensDebug || {};
  const logger = Debug.createLogger
    ? Debug.createLogger("backend-resolver")
    : console;

  const DEFAULT_TIMEOUT_MS = 7000;

  Providers.backendResolver = {
    resolve
  };

  async function resolve(context) {
    const endpoint = String(context?.backendEndpoint || "").trim();
    logger.info("resolve:start", {
      traceId: context?.traceId || "",
      endpoint,
      videoId: context?.adapter?.videoId || "",
      requestedLanguageCode: context?.requestedLanguageCode || null
    });
    if (!endpoint) {
      logger.warn("resolve:missingEndpoint", {
        traceId: context?.traceId || ""
      });
      return buildFailure(
        "backend_endpoint_missing",
        "Backend transcript fallback is enabled, but no endpoint is configured.",
        context,
        true
      );
    }

    const startedAt = Date.now();
    const abortController = new AbortController();
    const cleanupParentAbort = linkParentAbort(context?.signal, abortController);
    const timeoutMs = Math.max(
      1,
      Math.min(
        Number(context?.backendTimeoutMs) || DEFAULT_TIMEOUT_MS,
        Math.max(1, Number(context?.remainingEndToEndMs) || DEFAULT_TIMEOUT_MS)
      )
    );

    try {
      const response = await promiseWithTimeout(
        fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          signal: abortController.signal,
          body: JSON.stringify({
            videoId: context?.adapter?.videoId || "",
            url: context?.adapter?.url || "",
            requestedLanguageCode: context?.requestedLanguageCode || null,
            includeTimestamps: true,
            extensionVersion: context?.extensionVersion || "0.0.0",
            traceId: context?.traceId || ""
          })
        }),
        timeoutMs,
        () => abortController.abort()
      );
      cleanupParentAbort();
      logger.info("resolve:httpResponse", {
        traceId: context?.traceId || "",
        status: response.status || 0,
        ok: Boolean(response.ok)
      });

      if (!response.ok) {
        return buildFailure(
          `backend_http_${response.status}`,
          `The backend transcript resolver returned ${response.status}.`,
          context,
          false,
          Date.now() - startedAt
        );
      }

      const payload = await response.json();
      logger.info("resolve:payload", {
        traceId: context?.traceId || "",
        ok: Boolean(payload?.ok),
        strategy: payload?.strategy || "",
        sourceLabel: payload?.sourceLabel || "",
        warnings: Array.isArray(payload?.warnings) ? payload.warnings.slice(0, 6) : [],
        textLength: String(payload?.text || "").length,
        segmentCount: Array.isArray(payload?.segments) ? payload.segments.length : 0
      });
      if (!payload?.ok || !payload?.text) {
        return buildFailure(
          payload?.errorCode || "backend_empty",
          payload?.errorMessage || "The backend transcript resolver returned no transcript text.",
          context,
          false,
          Date.now() - startedAt,
          payload?.warnings || []
        );
      }

      const candidate = Transcript.normalize.normalizeCandidate(
        {
          ok: true,
          provider: "backendResolver",
          providerClass: "backend",
          strategy: payload.strategy || "backend-transcript",
          sourceLabel: payload.sourceLabel || "Backend transcript fallback",
          sourceConfidence: payload.sourceConfidence || "high",
          quality: payload.quality || null,
          languageCode: payload.languageCode || null,
          originalLanguageCode: payload.originalLanguageCode || payload.languageCode || null,
          requestedLanguageCode: context?.requestedLanguageCode || null,
          isGenerated:
            typeof payload.isGenerated === "boolean" ? payload.isGenerated : null,
          isTranslated: Boolean(payload.isTranslated),
          isMachineTranslated: Boolean(payload.isMachineTranslated),
          videoDurationSeconds: payload.videoDurationSeconds || null,
          transcriptSpanSeconds: payload.transcriptSpanSeconds || null,
          segmentQualityScore: payload.segmentQualityScore || null,
          segments: Array.isArray(payload.segments) ? payload.segments : [],
          text: payload.text,
          warnings: []
            .concat(payload.warnings || [])
            .concat(["backend_fallback_used"]),
          resolverAttempts: [
            buildAttempt(
              payload.strategy || "backend-transcript",
              true,
              false,
              Date.now() - startedAt,
              payload.sourceConfidence || "high",
              payload.warnings || [],
              null
            )
          ],
          resolverPath: [`backendResolver:${payload.strategy || "backend-transcript"}`],
          winnerSelectedBy: ["backend-success"]
        },
        {
          maxTextLength: context?.maxTextLength || 18000,
          requestedLanguageCode: context?.requestedLanguageCode || null
        }
      );

      logger.info("resolve:success", {
        traceId: context?.traceId || "",
        candidate: summarizeCandidate(candidate)
      });
      return candidate;
    } catch (error) {
      cleanupParentAbort();
      const code = context?.signal?.aborted ? "navigation_changed" : classifyError(error);
      logger.warn("resolve:failed", {
        traceId: context?.traceId || "",
        code,
        error: {
          message: error?.message || "",
          stack: error?.stack || ""
        }
      });
      return buildFailure(
        code,
        code === "backend_timeout"
          ? "The backend transcript resolver timed out."
          : error?.message || "The backend transcript resolver failed.",
        context,
        false,
        Date.now() - startedAt
      );
    }
  }

  function buildFailure(code, message, context, skipped, durationMs, warningCodes) {
    return Transcript.normalize.buildUnavailableResult({
      provider: "backendResolver",
      providerClass: "backend",
      strategy: "backend-transcript",
      sourceLabel: "Backend transcript unavailable",
      sourceConfidence: "low",
      requestedLanguageCode: context?.requestedLanguageCode || null,
      videoDurationSeconds: context?.adapter?.videoDurationSeconds || null,
      warnings: warningCodes || [],
      errors: [
        {
          provider: "backendResolver",
          strategy: "backend-transcript",
          code,
          message
        }
      ],
      resolverAttempts: [
        buildAttempt(
          "backend-transcript",
          false,
          skipped,
          durationMs || 0,
          null,
          warningCodes || [],
          code
        )
      ],
      resolverPath: skipped ? [] : ["backendResolver:backend-transcript"],
      winnerSelectedBy: ["backend-unavailable"],
      failureReason: code
    });
  }

  function buildAttempt(strategy, ok, skipped, durationMs, sourceConfidence, warningCodes, errorCode) {
    return {
      provider: "backendResolver",
      strategy,
      ok: Boolean(ok),
      skipped: Boolean(skipped),
      durationMs: Math.max(0, Math.round(durationMs || 0)),
      sourceConfidence: sourceConfidence || null,
      warningCodes: Array.isArray(warningCodes) ? warningCodes.slice() : [],
      errorCode: errorCode || null
    };
  }

  function classifyError(error) {
    const message = String(error?.message || "");
    if (/timeout/i.test(message)) {
      return "backend_timeout";
    }
    return "backend_failed";
  }

  function promiseWithTimeout(promise, timeoutMs, onTimeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (typeof onTimeout === "function") {
          onTimeout();
        }
        reject(new Error("timeout"));
      }, timeoutMs);

      Promise.resolve(promise)
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  function linkParentAbort(parentSignal, abortController) {
    if (!parentSignal) {
      return () => {};
    }

    const handleAbort = () => {
      abortController.abort(parentSignal.reason);
    };

    if (parentSignal.aborted) {
      handleAbort();
      return () => {};
    }

    parentSignal.addEventListener("abort", handleAbort, { once: true });
    return () => {
      parentSignal.removeEventListener("abort", handleAbort);
    };
  }

  function summarizeCandidate(candidate) {
    if (!candidate) {
      return null;
    }

    return {
      ok: Boolean(candidate.ok),
      strategy: candidate.strategy || "",
      quality: candidate.quality || null,
      sourceConfidence: candidate.sourceConfidence || null,
      warnings: Array.isArray(candidate.warnings) ? candidate.warnings.slice(0, 6) : [],
      segmentCount: candidate.segmentCount || 0,
      coverageRatio:
        typeof candidate.coverageRatio === "number" ? candidate.coverageRatio : null,
      textLength: String(candidate.text || "").length
    };
  }
})(globalThis);
