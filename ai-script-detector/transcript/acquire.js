(function (root) {
  const ScriptLens = (root.ScriptLens = root.ScriptLens || {});
  const Transcript = (ScriptLens.transcript = ScriptLens.transcript || {});

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

    const localResult = await youtubeResolver.resolve({
      ...context,
      traceId,
      totalTimeoutMs
    });
    const escalation = Transcript.normalize.shouldEscalateToBackend(localResult);

    if (
      !context?.allowBackendTranscriptFallback ||
      escalation.reason === "navigation_changed" ||
      !backendResolver
    ) {
      return Transcript.normalize.stripInternalFields(localResult);
    }

    const remainingEndToEndMs = Math.max(0, totalTimeoutMs - (Date.now() - startedAt));
    if (!escalation.shouldEscalate || remainingEndToEndMs <= 0) {
      return Transcript.normalize.stripInternalFields(localResult);
    }

    const backendResult = await backendResolver.resolve({
      ...context,
      traceId,
      remainingEndToEndMs,
      backendTimeoutMs: Math.min(BACKEND_TIMEOUT_MS, remainingEndToEndMs)
    });

    const winner = chooseWinner(localResult, backendResult);
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
})(globalThis);
