(function (root) {
  const ScriptLens = (root.ScriptLens = root.ScriptLens || {});
  const Transcript = (ScriptLens.transcript = ScriptLens.transcript || {});
  const Text = (root.AIScriptDetector || {}).text;
  const Stats = (root.AIScriptDetector || {}).stats;

  const STRATEGY_PRIORITY = {
    "caption-track": 1,
    "dom-transcript": 2,
    "youtubei-transcript": 3,
    "description-transcript": 4,
    "title-description": 5,
    "local-whisper": 6,
    "backend-transcript": 7
  };

  const CONFIDENCE_RANK = {
    high: 3,
    medium: 2,
    low: 1
  };

  const QUALITY_RANK = {
    "strong-transcript": 3,
    "partial-transcript": 2,
    "weak-fallback": 1,
    "enhanced-extraction-unavailable": 0
  };

  const VALID_CONFIDENCES = new Set(["high", "medium", "low"]);
  const VALID_QUALITIES = new Set([
    "strong-transcript",
    "partial-transcript",
    "weak-fallback",
    "enhanced-extraction-unavailable"
  ]);

  const TRANSCRIPT_STRATEGIES = new Set([
    "youtubei-transcript",
    "caption-track",
    "dom-transcript",
    "backend-transcript"
  ]);

  const BACKEND_ESCALATION_FAILURE_CODES = new Set([
    "youtubei_failed_precondition",
    "youtubei_params_missing",
    "youtubei_bootstrap_incomplete",
    "youtubei_empty",
    "caption_tracks_missing",
    "caption_track_unavailable",
    "caption_fetch_failed"
  ]);

  const BACKEND_IMPROVEMENT_THRESHOLDS = {
    coverageRatio: 0.15,
    transcriptSpanSeconds: 90,
    segmentQualityScore: 10
  };

  Transcript.normalize = {
    STRATEGY_PRIORITY,
    CONFIDENCE_RANK,
    QUALITY_RANK,
    normalizeCandidate,
    normalizeDirectAcquisition,
    normalizeAttempts,
    compareCandidates,
    buildUnavailableResult,
    stripInternalFields,
    isTranscriptStrategy,
    isTranscriptClassQuality,
    isRealTranscriptSource,
    mapTranscriptAcquisitionState,
    shouldEscalateToBackend,
    getFailureCodes
  };

  function normalizeCandidate(rawCandidate, options) {
    const safeOptions = {
      maxTextLength: Number(options?.maxTextLength) || 18000,
      requestedLanguageCode: options?.requestedLanguageCode || null
    };

    const strategy = rawCandidate?.strategy || "title-description";
    const provider = rawCandidate?.provider || "youtubeResolver";
    const providerClass = deriveProviderClass(rawCandidate?.providerClass, provider);
    const sourceLabel = buildSourceLabel(strategy, rawCandidate);
    const segments = normalizeSegments(rawCandidate?.segments || [], strategy);
    const rawText = buildCandidateText(rawCandidate, segments, strategy);
    const truncated = Text.smartTruncate(rawText, safeOptions.maxTextLength);
    const text = truncated.text;
    const wordCount = Text.countWords(text);
    const originalLanguageCode = normalizeLanguage(
      rawCandidate?.originalLanguageCode || rawCandidate?.languageCode || null
    );
    const languageCode = normalizeLanguage(
      rawCandidate?.languageCode || rawCandidate?.originalLanguageCode || null
    );
    const isTranslated = Boolean(rawCandidate?.isTranslated);
    const isMachineTranslated = Boolean(rawCandidate?.isMachineTranslated);
    const isGenerated =
      typeof rawCandidate?.isGenerated === "boolean" ? rawCandidate.isGenerated : null;
    const videoDurationSeconds = toFiniteNumber(rawCandidate?.videoDurationSeconds);
    const transcriptSpanSeconds =
      strategy === "title-description"
        ? null
        : toFiniteNumber(rawCandidate?.transcriptSpanSeconds) ??
          computeTranscriptSpanSeconds(segments);
    const coverageRatio = computeCoverageRatio({
      strategy,
      transcriptSpanSeconds,
      videoDurationSeconds,
      segmentCount: segments.length,
      text
    });
    const avgSegmentLength =
      strategy === "title-description" || !segments.length
        ? null
        : roundTo(
            average(
              segments.map((segment) => Math.max(1, Text.countWords(segment.text || "")))
            ),
            1
          );
    const sourceConfidence =
      normalizeConfidence(rawCandidate?.sourceConfidence) ||
      deriveSourceConfidence(strategy, isGenerated, providerClass);
    const segmentQualityScore =
      toFiniteNumber(rawCandidate?.segmentQualityScore) ??
      (strategy === "title-description" ? 0 : computeSegmentQualityScore(segments));
    const usableTranscript = isUsableTranscript({
      strategy,
      text,
      wordCount,
      segmentCount: segments.length,
      transcriptSpanSeconds,
      coverageRatio
    });
    const computedQuality = deriveQuality({
      strategy,
      text,
      usableTranscript,
      sourceConfidence,
      coverageRatio,
      transcriptSpanSeconds,
      segmentQualityScore
    });
    const quality = normalizeQuality(rawCandidate?.quality) || computedQuality;

    const warnings = dedupeList(
      []
        .concat(rawCandidate?.warnings || [])
        .concat(strategy === "title-description" ? ["fallback_source", "weak_evidence"] : [])
        .concat(strategy === "description-transcript" ? ["weak_evidence"] : [])
        .concat(isGenerated ? ["generated_captions"] : [])
        .concat(isTranslated ? ["translated_text"] : [])
        .concat(providerClass === "backend" ? ["backend_fallback_used"] : [])
        .concat(
          TRANSCRIPT_STRATEGIES.has(strategy) && text && !usableTranscript
            ? ["below_usable_threshold"]
            : []
        )
    );

    const ok = Boolean(text);
    const errors = Array.isArray(rawCandidate?.errors) ? rawCandidate.errors.slice() : [];
    const failureReason =
      rawCandidate?.failureReason || (!ok ? deriveFailureReason(rawCandidate, errors) : null);

    return {
      ok,
      kind: "transcript",
      provider,
      providerClass,
      strategy,
      sourceLabel,
      sourceConfidence,
      quality,
      acquisitionState: mapTranscriptAcquisitionState(quality, ok),
      transcriptRequiredSatisfied: isTranscriptClassQuality(quality),
      failureReason,
      languageCode,
      originalLanguageCode,
      requestedLanguageCode: normalizeLanguage(
        rawCandidate?.requestedLanguageCode || safeOptions.requestedLanguageCode || null
      ),
      isGenerated,
      isTranslated,
      isMachineTranslated,
      segmentCount: strategy === "title-description" ? 0 : segments.length,
      avgSegmentLength,
      coverageRatio,
      videoDurationSeconds,
      transcriptSpanSeconds:
        strategy === "title-description" ? null : transcriptSpanSeconds,
      segmentQualityScore: strategy === "title-description" ? 0 : segmentQualityScore,
      truncated: Boolean(truncated.truncated),
      warnings,
      errors,
      resolverAttempts: normalizeAttempts(rawCandidate?.resolverAttempts || []),
      resolverPath: Array.isArray(rawCandidate?.resolverPath)
        ? rawCandidate.resolverPath.slice()
        : [],
      winnerSelectedBy: Array.isArray(rawCandidate?.winnerSelectedBy)
        ? rawCandidate.winnerSelectedBy.slice()
        : [],
      requestShapeValidation: rawCandidate?.requestShapeValidation || null,
      text,
      segments,
      __segmentQualityScore: segmentQualityScore,
      __wordCount: wordCount,
      __usableTranscript: usableTranscript,
      __priorityRank: STRATEGY_PRIORITY[strategy] || 99
    };
  }

  function normalizeDirectAcquisition(rawCandidate, options) {
    const safeOptions = {
      maxTextLength: Number(options?.maxTextLength) || 18000
    };
    const kind = normalizeDirectKind(rawCandidate?.kind || rawCandidate?.sourceType);
    const rawText = Text.sanitizeInput(rawCandidate?.text || "");
    const truncated = Text.smartTruncate(rawText, safeOptions.maxTextLength);
    const text = truncated.text;
    const wordCount = Text.countWords(text);
    const coverageRatio = toFiniteNumber(
      rawCandidate?.coverageRatio ?? rawCandidate?.metadata?.coverageRatio
    );
    const blockCount = Math.max(
      0,
      Math.round(
        Number(rawCandidate?.blockCount ?? rawCandidate?.metadata?.blockCount) || 0
      )
    );
    const paragraphCount = Text.splitParagraphs(text).length;
    const sourceConfidence = deriveDirectSourceConfidence({
      kind,
      wordCount,
      blockCount,
      paragraphCount,
      coverageRatio
    });
    const quality = deriveDirectQuality(text, sourceConfidence);
    const warnings = dedupeList(
      []
        .concat(rawCandidate?.warnings || [])
        .concat(sourceConfidence === "low" ? ["weak_evidence"] : [])
        .concat(kind === "selection" ? ["limited_context"] : [])
        .concat(
          kind === "page-content" &&
            coverageRatio !== null &&
            coverageRatio < 0.18
            ? ["page_capture_noise"]
            : []
        )
    );

    return {
      ok: Boolean(text),
      kind,
      provider: null,
      providerClass: "local",
      strategy: null,
      sourceLabel: buildDirectSourceLabel(kind, rawCandidate),
      sourceConfidence,
      quality,
      acquisitionState: null,
      transcriptRequiredSatisfied: true,
      failureReason: null,
      languageCode: normalizeLanguage(rawCandidate?.languageCode || null),
      originalLanguageCode: normalizeLanguage(rawCandidate?.originalLanguageCode || null),
      requestedLanguageCode: null,
      isGenerated: null,
      isTranslated: false,
      isMachineTranslated: false,
      segmentCount: 0,
      avgSegmentLength: null,
      coverageRatio,
      videoDurationSeconds: null,
      transcriptSpanSeconds: null,
      segmentQualityScore: null,
      truncated: Boolean(truncated.truncated),
      warnings,
      errors: Array.isArray(rawCandidate?.errors) ? rawCandidate.errors.slice() : [],
      resolverAttempts: normalizeAttempts(rawCandidate?.resolverAttempts || []),
      resolverPath: Array.isArray(rawCandidate?.resolverPath)
        ? rawCandidate.resolverPath.slice()
        : [],
      winnerSelectedBy: Array.isArray(rawCandidate?.winnerSelectedBy)
        ? rawCandidate.winnerSelectedBy.slice()
        : [],
      requestShapeValidation: null,
      text,
      segments: [],
      __wordCount: wordCount,
      __paragraphCount: paragraphCount
    };
  }

  function normalizeAttempts(attempts) {
    return (Array.isArray(attempts) ? attempts : []).map((attempt) => ({
      provider: attempt.provider || "youtubeResolver",
      strategy: attempt.strategy || "title-description",
      ok: Boolean(attempt.ok),
      skipped: Boolean(attempt.skipped),
      durationMs: Math.max(0, Math.round(Number(attempt.durationMs) || 0)),
      sourceConfidence: attempt.sourceConfidence || null,
      warningCodes: Array.isArray(attempt.warningCodes) ? attempt.warningCodes.slice() : [],
      errorCode: attempt.errorCode || null
    }));
  }

  function buildUnavailableResult(input) {
    const errors = Array.isArray(input?.errors) ? input.errors.slice() : [];
    const warnings = dedupeList(
      []
        .concat(input?.warnings || [])
        .concat(input?.helperUnavailable ? ["enhanced_extraction_unavailable"] : [])
    );

    return {
      ok: false,
      kind: "transcript",
      provider: input?.provider || "youtubeResolver",
      providerClass: input?.providerClass || "local",
      strategy: input?.strategy || "transcript-unavailable",
      sourceLabel: input?.sourceLabel || "Transcript unavailable",
      sourceConfidence: input?.sourceConfidence || "low",
      quality: "enhanced-extraction-unavailable",
      acquisitionState: "transcript-unavailable",
      transcriptRequiredSatisfied: false,
      failureReason:
        input?.failureReason || deriveFailureReason(input, errors) || "resolver_exhausted",
      languageCode: null,
      originalLanguageCode: null,
      requestedLanguageCode: normalizeLanguage(input?.requestedLanguageCode || null),
      isGenerated: null,
      isTranslated: false,
      isMachineTranslated: false,
      segmentCount: 0,
      avgSegmentLength: null,
      coverageRatio: null,
      videoDurationSeconds: toFiniteNumber(input?.videoDurationSeconds),
      transcriptSpanSeconds: null,
      segmentQualityScore: 0,
      truncated: false,
      warnings,
      errors,
      resolverAttempts: normalizeAttempts(input?.resolverAttempts || []),
      resolverPath: Array.isArray(input?.resolverPath) ? input.resolverPath.slice() : [],
      winnerSelectedBy: Array.isArray(input?.winnerSelectedBy)
        ? input.winnerSelectedBy.slice()
        : [],
      requestShapeValidation: input?.requestShapeValidation || null,
      text: "",
      segments: []
    };
  }

  function stripInternalFields(value) {
    const clone = {};
    Object.keys(value || {}).forEach((key) => {
      if (!/^__/.test(key)) {
        clone[key] = value[key];
      }
    });
    return clone;
  }

  function compareCandidates(left, right) {
    if (!left) {
      return {
        winner: right,
        loser: left,
        reasons: ["single-candidate"]
      };
    }
    if (!right) {
      return {
        winner: left,
        loser: right,
        reasons: ["single-candidate"]
      };
    }

    const transcriptPriorityWinner = compareTranscriptPriority(left, right);
    if (transcriptPriorityWinner) {
      return transcriptPriorityWinner;
    }

    const reasons = [];
    const confidenceDelta =
      (CONFIDENCE_RANK[left.sourceConfidence] || 0) -
      (CONFIDENCE_RANK[right.sourceConfidence] || 0);
    if (confidenceDelta !== 0) {
      const winner = confidenceDelta > 0 ? left : right;
      const loser = confidenceDelta > 0 ? right : left;
      reasons.push(`confidence:${winner.sourceConfidence}>${loser.sourceConfidence}`);
      return { winner, loser, reasons };
    }

    const leftCoverage = normalizeComparableNumber(left.coverageRatio);
    const rightCoverage = normalizeComparableNumber(right.coverageRatio);
    const coverageGap = Math.abs(leftCoverage - rightCoverage);
    const leftManual = left.isGenerated === false;
    const rightManual = right.isGenerated === false;

    if (coverageGap <= 0.15 && leftManual !== rightManual) {
      const winner = leftManual ? left : right;
      const loser = leftManual ? right : left;
      reasons.push("manual-over-generated");
      return { winner, loser, reasons };
    }

    const leftIsOriginal = isCanonicalLanguageCandidate(left);
    const rightIsOriginal = isCanonicalLanguageCandidate(right);
    if (leftIsOriginal !== rightIsOriginal) {
      const winner = leftIsOriginal ? left : right;
      const loser = leftIsOriginal ? right : left;
      reasons.push(`original-language:${leftIsOriginal}>${rightIsOriginal}`);
      return { winner, loser, reasons };
    }

    if (coverageGap > 0.02) {
      const winner = leftCoverage > rightCoverage ? left : right;
      const loser = leftCoverage > rightCoverage ? right : left;
      reasons.push(
        `coverage:${formatComparableNumber(
          winner.coverageRatio
        )}>${formatComparableNumber(loser.coverageRatio)}`
      );
      return { winner, loser, reasons };
    }

    const segmentQualityGap = Math.abs(
      (left.__segmentQualityScore || 0) - (right.__segmentQualityScore || 0)
    );
    if (segmentQualityGap > 3) {
      const winner =
        (left.__segmentQualityScore || 0) > (right.__segmentQualityScore || 0)
          ? left
          : right;
      const loser = winner === left ? right : left;
      reasons.push(
        `segment-quality:${Math.round(winner.__segmentQualityScore || 0)}>${Math.round(
          loser.__segmentQualityScore || 0
        )}`
      );
      return { winner, loser, reasons };
    }

    const leftVolume = calculateUsableVolume(left);
    const rightVolume = calculateUsableVolume(right);
    if (Math.abs(leftVolume - rightVolume) > 20) {
      const winner = leftVolume > rightVolume ? left : right;
      const loser = winner === left ? right : left;
      reasons.push(`usable-volume:${Math.round(leftVolume)}>${Math.round(rightVolume)}`);
      return { winner, loser, reasons };
    }

    if (left.providerClass !== right.providerClass) {
      const winner = left.providerClass === "local" ? left : right;
      const loser = winner === left ? right : left;
      reasons.push("privacy-tiebreaker:local");
      return { winner, loser, reasons };
    }

    const winner = (left.__priorityRank || 99) <= (right.__priorityRank || 99) ? left : right;
    const loser = winner === left ? right : left;
    reasons.push(`priority-tiebreaker:${winner.strategy}>${loser.strategy}`);
    return { winner, loser, reasons };
  }

  function isTranscriptStrategy(strategy) {
    return TRANSCRIPT_STRATEGIES.has(strategy);
  }

  function isTranscriptClassQuality(quality) {
    return quality === "strong-transcript" || quality === "partial-transcript";
  }

  function isRealTranscriptSource(candidate) {
    return Boolean(
      candidate &&
        candidate.kind === "transcript" &&
        isTranscriptClassQuality(candidate.quality)
    );
  }

  function mapTranscriptAcquisitionState(quality, ok) {
    if (!ok || quality === "enhanced-extraction-unavailable") {
      return "transcript-unavailable";
    }
    if (quality === "strong-transcript") {
      return "transcript-acquired";
    }
    if (quality === "partial-transcript") {
      return "partial-transcript";
    }
    return "fallback-text-only";
  }

  function shouldEscalateToBackend(candidate) {
    const failureCodes = getFailureCodes(candidate);
    if (failureCodes.includes("navigation_changed")) {
      return {
        shouldEscalate: false,
        reason: "navigation_changed"
      };
    }

    if (failureCodes.some((code) => BACKEND_ESCALATION_FAILURE_CODES.has(code))) {
      return {
        shouldEscalate: true,
        reason: failureCodes.find((code) => BACKEND_ESCALATION_FAILURE_CODES.has(code))
      };
    }

    if (!candidate?.ok) {
      return {
        shouldEscalate: true,
        reason: "no_transcript_class_source"
      };
    }

    if (!isTranscriptClassQuality(candidate.quality)) {
      return {
        shouldEscalate: true,
        reason: "quality_below_threshold"
      };
    }

    if (candidate.quality !== "strong-transcript") {
      return {
        shouldEscalate: true,
        reason: "quality_below_threshold"
      };
    }

    if ((candidate.coverageRatio || 0) < 0.45) {
      return {
        shouldEscalate: true,
        reason: "coverage_below_threshold"
      };
    }

    if ((candidate.transcriptSpanSeconds || 0) < 120) {
      return {
        shouldEscalate: true,
        reason: "span_below_threshold"
      };
    }

    if ((candidate.segmentQualityScore || candidate.__segmentQualityScore || 0) < 60) {
      return {
        shouldEscalate: true,
        reason: "segment_quality_below_threshold"
      };
    }

    return {
      shouldEscalate: false,
      reason: "local_strong_transcript"
    };
  }

  function getFailureCodes(candidate) {
    const codes = [];

    if (candidate?.failureReason) {
      codes.push(candidate.failureReason);
    }

    (candidate?.errors || []).forEach((error) => {
      if (error?.code) {
        codes.push(error.code);
      }
    });

    (candidate?.resolverAttempts || []).forEach((attempt) => {
      if (attempt?.errorCode) {
        codes.push(attempt.errorCode);
      }
    });

    return dedupeList(codes);
  }

  function compareTranscriptPriority(left, right) {
    const leftRealTranscript = isRealTranscriptSource(left);
    const rightRealTranscript = isRealTranscriptSource(right);
    if (leftRealTranscript !== rightRealTranscript) {
      const winner = leftRealTranscript ? left : right;
      const loser = leftRealTranscript ? right : left;
      return {
        winner,
        loser,
        reasons: ["transcript-over-fallback"]
      };
    }

    if (left.providerClass === right.providerClass) {
      return null;
    }

    const local = left.providerClass === "local" ? left : right;
    const backend = local === left ? right : left;

    if (local.quality === "strong-transcript") {
      return {
        winner: local,
        loser: backend,
        reasons: ["local-strong-transcript-over-backend"]
      };
    }

    if (local.quality === "weak-fallback" || !local.ok) {
      return {
        winner: backend,
        loser: local,
        reasons: ["backend-over-local-weak"]
      };
    }

    if (backend.quality === "strong-transcript" && local.quality === "partial-transcript") {
      return {
        winner: backend,
        loser: local,
        reasons: ["backend-strong-over-local-partial"]
      };
    }

    if (local.quality === "partial-transcript") {
      const backendConfidence = CONFIDENCE_RANK[backend.sourceConfidence] || 0;
      const localConfidence = CONFIDENCE_RANK[local.sourceConfidence] || 0;

      if (backendConfidence >= localConfidence) {
        const backendQualityRank = QUALITY_RANK[backend.quality] || 0;
        const localQualityRank = QUALITY_RANK[local.quality] || 0;

        if (backendQualityRank > localQualityRank) {
          return {
            winner: backend,
            loser: local,
            reasons: ["backend-materially-better:quality"]
          };
        }

        if (
          normalizedNumber(backend.coverageRatio) >=
          normalizedNumber(local.coverageRatio) + BACKEND_IMPROVEMENT_THRESHOLDS.coverageRatio
        ) {
          return {
            winner: backend,
            loser: local,
            reasons: ["backend-materially-better:coverage"]
          };
        }

        if (
          normalizedNumber(backend.transcriptSpanSeconds) >=
          normalizedNumber(local.transcriptSpanSeconds) +
            BACKEND_IMPROVEMENT_THRESHOLDS.transcriptSpanSeconds
        ) {
          return {
            winner: backend,
            loser: local,
            reasons: ["backend-materially-better:span"]
          };
        }

        if (
          normalizedNumber(backend.segmentQualityScore || backend.__segmentQualityScore) >=
          normalizedNumber(local.segmentQualityScore || local.__segmentQualityScore) +
            BACKEND_IMPROVEMENT_THRESHOLDS.segmentQualityScore
        ) {
          return {
            winner: backend,
            loser: local,
            reasons: ["backend-materially-better:segment-quality"]
          };
        }
      }

      return {
        winner: local,
        loser: backend,
        reasons: ["local-privacy-tiebreaker"]
      };
    }

    return null;
  }

  function buildCandidateText(rawCandidate, segments, strategy) {
    if (strategy === "title-description") {
      return Text.sanitizeInput(rawCandidate?.text || "");
    }

    if (segments.length) {
      return Text.sanitizeInput(
        segments
          .map((segment) => segment.text)
          .filter(Boolean)
          .join("\n")
      );
    }

    return Text.sanitizeInput(rawCandidate?.text || "");
  }

  function normalizeSegments(segments, strategy) {
    if (strategy === "title-description") {
      return [];
    }

    return (Array.isArray(segments) ? segments : [])
      .map((segment) => ({
        startMs: toFiniteNumber(segment?.startMs),
        durationMs: toFiniteNumber(segment?.durationMs),
        text: Text.sanitizeInput(segment?.text || "")
      }))
      .filter((segment) => Boolean(segment.text));
  }

  function deriveProviderClass(explicitValue, provider) {
    const value = String(explicitValue || "").trim().toLowerCase();
    if (value === "backend") {
      return "backend";
    }
    if (value === "local") {
      return "local";
    }

    return /backend/i.test(String(provider || "")) ? "backend" : "local";
  }

  function deriveSourceConfidence(strategy, isGenerated, providerClass) {
    if (providerClass === "backend" && strategy === "backend-transcript") {
      return "high";
    }
    if (strategy === "youtubei-transcript") {
      return "medium";
    }
    if (strategy === "caption-track") {
      return isGenerated ? "medium" : "high";
    }
    if (strategy === "dom-transcript") {
      return "medium";
    }
    if (strategy === "description-transcript" || strategy === "title-description") {
      return "low";
    }
    return providerClass === "backend" ? "high" : "medium";
  }

  function deriveDirectSourceConfidence(input) {
    if (!input.wordCount) {
      return "low";
    }

    if (input.kind === "manual-input") {
      if (input.wordCount >= 500) {
        return "high";
      }
      return input.wordCount >= 180 ? "medium" : "low";
    }

    if (input.kind === "selection") {
      if (input.wordCount >= 320) {
        return "high";
      }
      return input.wordCount >= 110 ? "medium" : "low";
    }

    if (input.kind === "article-content") {
      if (
        input.wordCount >= 450 &&
        input.blockCount >= 5 &&
        (input.coverageRatio === null || input.coverageRatio >= 0.18)
      ) {
        return "high";
      }
      return input.wordCount >= 180 ? "medium" : "low";
    }

    if (input.kind === "page-content") {
      if (
        input.wordCount >= 550 &&
        input.blockCount >= 6 &&
        (input.coverageRatio === null || input.coverageRatio >= 0.24)
      ) {
        return "high";
      }
      return input.wordCount >= 180 ? "medium" : "low";
    }

    return input.wordCount >= 180 ? "medium" : "low";
  }

  function deriveQuality(input) {
    if (!input.text) {
      return "enhanced-extraction-unavailable";
    }

    if (
      TRANSCRIPT_STRATEGIES.has(input.strategy) &&
      input.sourceConfidence === "high" &&
      (((input.coverageRatio || 0) >= 0.45) || ((input.transcriptSpanSeconds || 0) >= 120)) &&
      input.segmentQualityScore >= 60
    ) {
      return "strong-transcript";
    }

    if (TRANSCRIPT_STRATEGIES.has(input.strategy)) {
      return "partial-transcript";
    }

    if (input.strategy === "description-transcript" || input.strategy === "title-description") {
      return "weak-fallback";
    }

    return "enhanced-extraction-unavailable";
  }

  function deriveDirectQuality(text, sourceConfidence) {
    if (!text) {
      return "enhanced-extraction-unavailable";
    }
    if (sourceConfidence === "high") {
      return "strong-transcript";
    }
    if (sourceConfidence === "medium") {
      return "partial-transcript";
    }
    return "weak-fallback";
  }

  function isUsableTranscript(input) {
    if (!TRANSCRIPT_STRATEGIES.has(input.strategy)) {
      return false;
    }

    if (!input.text || input.text.length < 220 || input.wordCount < 50) {
      return false;
    }

    return (
      input.segmentCount >= 8 ||
      (input.transcriptSpanSeconds || 0) >= 45 ||
      (input.coverageRatio || 0) >= 0.18
    );
  }

  function computeCoverageRatio(input) {
    if (!input.text) {
      return null;
    }

    if (input.strategy === "title-description") {
      return null;
    }

    if (isFiniteNumber(input.transcriptSpanSeconds) && isFiniteNumber(input.videoDurationSeconds)) {
      return roundTo(
        Stats.clamp(input.transcriptSpanSeconds / Math.max(1, input.videoDurationSeconds), 0, 1),
        3
      );
    }

    if (input.segmentCount > 0) {
      return roundTo(
        Stats.clamp(Math.max(input.segmentCount / 48, Text.countWords(input.text) / 900), 0, 1),
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
    if (!isFiniteNumber(startMs) || !isFiniteNumber(endMs) || endMs <= startMs) {
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
      segments.map((segment) => Math.max(1, Text.countWords(segment.text || "")))
    );
    const nearEmptyRatio =
      segments.filter((segment) => Text.countWords(segment.text || "") <= 1).length /
      segments.length;
    const monotonicity = computeMonotonicity(segments);
    const countScore = Stats.normalizeRange(segments.length, 4, 48) * 25;
    const timestampScore = timestampRatio * 30;
    const continuityScore = monotonicity * 15;
    const densityScore = Math.max(0, 20 - Math.abs(avgWords - 10) * 2);
    const emptyPenalty = nearEmptyRatio * 20;

    return Math.round(
      Stats.clamp(countScore + timestampScore + continuityScore + densityScore - emptyPenalty, 0, 100)
    );
  }

  function computeMonotonicity(segments) {
    const values = segments
      .map((segment) => segment.startMs)
      .filter((value) => isFiniteNumber(value));
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

  function calculateUsableVolume(candidate) {
    const span = normalizeComparableNumber(candidate.transcriptSpanSeconds) * 120;
    const words = normalizeComparableNumber(candidate.__wordCount || 0);
    return span + words;
  }

  function buildSourceLabel(strategy, rawCandidate) {
    if (rawCandidate?.sourceLabel) {
      return rawCandidate.sourceLabel;
    }
    if (strategy === "youtubei-transcript") {
      return rawCandidate?.trackLabel || "YouTube transcript";
    }
    if (strategy === "caption-track") {
      return rawCandidate?.trackLabel || "Caption track";
    }
    if (strategy === "dom-transcript") {
      return "Visible transcript";
    }
    if (strategy === "backend-transcript") {
      return "Backend transcript";
    }
    if (strategy === "description-transcript") {
      return "Description transcript";
    }
    if (strategy === "title-description") {
      return "Title + description fallback";
    }
    if (strategy === "local-whisper") {
      return "Local helper transcript";
    }
    return "Transcript source";
  }

  function buildDirectSourceLabel(kind, rawCandidate) {
    if (rawCandidate?.sourceLabel) {
      return rawCandidate.sourceLabel;
    }

    if (kind === "manual-input") {
      return "Pasted text";
    }
    if (kind === "selection") {
      return "Selected text";
    }
    if (kind === "article-content") {
      return "Article content";
    }
    return "Visible page content";
  }

  function isCanonicalLanguageCandidate(candidate) {
    if (candidate.isMachineTranslated || candidate.isTranslated) {
      return false;
    }
    if (!candidate.languageCode || !candidate.originalLanguageCode) {
      return true;
    }
    return candidate.languageCode === candidate.originalLanguageCode;
  }

  function deriveFailureReason(rawCandidate, errors) {
    if (rawCandidate?.failureReason) {
      return rawCandidate.failureReason;
    }

    if (Array.isArray(errors) && errors.length) {
      return errors[0].code || null;
    }

    if (Array.isArray(rawCandidate?.resolverAttempts)) {
      const failedAttempt = rawCandidate.resolverAttempts.find((attempt) => attempt.errorCode);
      if (failedAttempt?.errorCode) {
        return failedAttempt.errorCode;
      }
    }

    return null;
  }

  function normalizeComparableNumber(value) {
    return isFiniteNumber(value) ? Number(value) : -1;
  }

  function normalizedNumber(value) {
    return isFiniteNumber(value) ? Number(value) : 0;
  }

  function formatComparableNumber(value) {
    return isFiniteNumber(value) ? Number(value).toFixed(2) : "n/a";
  }

  function normalizeLanguage(value) {
    const text = String(value || "").trim().toLowerCase();
    return text || null;
  }

  function normalizeConfidence(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return VALID_CONFIDENCES.has(normalized) ? normalized : null;
  }

  function normalizeQuality(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return VALID_QUALITIES.has(normalized) ? normalized : null;
  }

  function normalizeDirectKind(value) {
    const text = String(value || "").trim().toLowerCase();
    if (
      text === "manual-input" ||
      text === "manual"
    ) {
      return "manual-input";
    }
    if (text === "selection") {
      return "selection";
    }
    if (text === "article-content" || text === "article") {
      return "article-content";
    }
    return "page-content";
  }

  function toFiniteNumber(value) {
    const nextValue = Number(value);
    return Number.isFinite(nextValue) ? nextValue : null;
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function average(values) {
    if (!Array.isArray(values) || !values.length) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function roundTo(value, precision) {
    if (!isFiniteNumber(value)) {
      return null;
    }
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
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
})(globalThis);
