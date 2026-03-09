(function (root) {
  const ScriptLens = (root.ScriptLens = root.ScriptLens || {});
  const Transcript = (ScriptLens.transcript = ScriptLens.transcript || {});
  const Debug = root.ScriptLensDebug || {};
  const logger = Debug.createLogger
    ? Debug.createLogger("transcript-acquire")
    : console;

  const TOTAL_TIMEOUT_MS = 15000;
  const BACKEND_TIMEOUT_MS = 7000;

  Transcript.acquire = {
    resolveBestTranscript
  };

  async function resolveBestTranscript(context) {
    const youtubeResolver = Transcript.providers?.youtubeResolver;
    const backendResolver = Transcript.providers?.backendResolver;
    const startedAt = Date.now();
    const totalTimeoutMs = Number(context?.totalTimeoutMs) || TOTAL_TIMEOUT_MS;
    const traceId = context?.traceId || buildTraceId();

    logger.info("resolveBestTranscript:start", {
      traceId,
      totalTimeoutMs,
      allowBackendTranscriptFallback: Boolean(context?.allowBackendTranscriptFallback),
      videoId: context?.adapter?.videoId || "",
      backendEndpoint: String(context?.backendEndpoint || "").trim()
    });

    const localResult = await youtubeResolver.resolve({
      ...context,
      traceId,
      totalTimeoutMs
    });
    const escalation = Transcript.normalize.shouldEscalateToBackend(localResult);
    logger.info("resolveBestTranscript:localResult", {
      traceId,
      escalation,
      localResult: summarizeCandidate(localResult)
    });

    if (
      !context?.allowBackendTranscriptFallback ||
      escalation.reason === "navigation_changed" ||
      !backendResolver
    ) {
      logger.info("resolveBestTranscript:returnLocal", {
        traceId,
        reason: !context?.allowBackendTranscriptFallback
          ? "backend-disabled"
          : escalation.reason === "navigation_changed"
            ? "navigation-changed"
            : "backend-missing"
      });
      return Transcript.normalize.stripInternalFields(localResult);
    }

    const remainingEndToEndMs = Math.max(0, totalTimeoutMs - (Date.now() - startedAt));
    if (!escalation.shouldEscalate || remainingEndToEndMs <= 0) {
      logger.info("resolveBestTranscript:skipBackend", {
        traceId,
        escalation,
        remainingEndToEndMs
      });
      return Transcript.normalize.stripInternalFields(localResult);
    }

    const backendResult = await backendResolver.resolve({
      ...context,
      traceId,
      remainingEndToEndMs,
      backendTimeoutMs: Math.min(BACKEND_TIMEOUT_MS, remainingEndToEndMs)
    });
    logger.info("resolveBestTranscript:backendResult", {
      traceId,
      backendResult: summarizeCandidate(backendResult)
    });

    const winner = chooseWinner(localResult, backendResult);
    logger.info("resolveBestTranscript:winner", {
      traceId,
      winner: summarizeCandidate(winner)
    });
    return Transcript.normalize.stripInternalFields(winner);
  }

  function chooseWinner(localResult, backendResult) {
    if (!backendResult) {
      return localResult;
    }

    if (!localResult) {
      return backendResult;
    }

    if (!backendResult.ok) {
      if (localResult.ok) {
        return mergeAcquisition(localResult, backendResult, ["backend-unavailable"]);
      }
      return mergeUnavailable(localResult, backendResult, ["backend-unavailable"]);
    }

    if (!localResult.ok) {
      return mergeAcquisition(backendResult, localResult, ["backend-over-local-unavailable"]);
    }

    const comparison = Transcript.normalize.compareCandidates(localResult, backendResult);
    const primary = comparison.winner;
    const secondary = primary === localResult ? backendResult : localResult;
    return mergeAcquisition(primary, secondary, comparison.reasons);
  }

  function mergeAcquisition(primary, secondary, selectionReasons) {
    return {
      ...primary,
      warnings: dedupeList([]
        .concat(primary.warnings || [])
        .concat(secondary?.warnings || [])),
      errors: []
        .concat(primary.errors || [])
        .concat(secondary?.errors || []),
      resolverAttempts: []
        .concat(primary.resolverAttempts || [])
        .concat(secondary?.resolverAttempts || []),
      resolverPath: []
        .concat(primary.resolverPath || [])
        .concat(
          (secondary?.resolverPath || []).filter(
            (entry) => !(primary.resolverPath || []).includes(entry)
          )
        ),
      winnerSelectedBy: []
        .concat(selectionReasons || [])
        .concat(secondary?.winnerSelectedBy || [])
    };
  }

  function mergeUnavailable(left, right, reasons) {
    return Transcript.normalize.buildUnavailableResult({
      provider: left?.provider || right?.provider || "youtubeResolver",
      providerClass: "local",
      strategy: left?.strategy || "transcript-unavailable",
      sourceLabel: "Transcript unavailable",
      sourceConfidence: "low",
      requestedLanguageCode:
        left?.requestedLanguageCode || right?.requestedLanguageCode || null,
      videoDurationSeconds:
        left?.videoDurationSeconds || right?.videoDurationSeconds || null,
      warnings: dedupeList([]
        .concat(left?.warnings || [])
        .concat(right?.warnings || [])),
      errors: []
        .concat(left?.errors || [])
        .concat(right?.errors || []),
      resolverAttempts: []
        .concat(left?.resolverAttempts || [])
        .concat(right?.resolverAttempts || []),
      resolverPath: []
        .concat(left?.resolverPath || [])
        .concat(right?.resolverPath || []),
      winnerSelectedBy: reasons || ["no-usable-candidate"],
      failureReason: left?.failureReason || right?.failureReason || "resolver_exhausted"
    });
  }

  function dedupeList(values) {
    const seen = new Set();
    return values.filter((value) => {
      const key = String(value || "");
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function buildTraceId() {
    return `trace-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function summarizeCandidate(candidate) {
    if (!candidate) {
      return null;
    }

    return {
      ok: Boolean(candidate.ok),
      provider: candidate.provider || null,
      providerClass: candidate.providerClass || null,
      strategy: candidate.strategy || null,
      quality: candidate.quality || null,
      sourceConfidence: candidate.sourceConfidence || null,
      failureReason: candidate.failureReason || null,
      warnings: Array.isArray(candidate.warnings) ? candidate.warnings.slice(0, 8) : [],
      errors: Array.isArray(candidate.errors)
        ? candidate.errors.slice(0, 6).map((error) => ({
            strategy: error?.strategy || "",
            code: error?.code || ""
          }))
        : []
    };
  }
})(globalThis);
