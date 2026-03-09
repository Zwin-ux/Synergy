(function (root) {
  const Surface = (root.ScriptLensSurface = root.ScriptLensSurface || {});

  Surface.buildPageContextViewModel = buildPageContextViewModel;
  Surface.buildReportViewModel = buildReportViewModel;
  Surface.buildInlineReportViewModel = buildInlineReportViewModel;
  Surface.buildRecentReportsViewModel = buildRecentReportsViewModel;
  Surface.getRequestLabel = getRequestLabel;
  Surface.renderBadges = renderBadges;
  Surface.getScorePalette = getScorePalette;
  Surface.getVerdictClass = getVerdictClass;
  Surface.formatAcquisitionQuality = formatAcquisitionQuality;
  Surface.formatCategoryName = formatCategoryName;
  Surface.toClassToken = toClassToken;
  Surface.capitalize = capitalize;
  Surface.escapeHtml = escapeHtml;
  Surface.formatSourceKind = formatSourceKind;

  function buildPageContextViewModel(context) {
    if (!context?.supported) {
      return {
        title: "Open a YouTube video",
        summary:
          context?.error ||
          "ScriptLens for Chrome currently supports desktop YouTube watch pages only.",
        badges: [{ label: "YouTube only", variant: "attention" }]
      };
    }

    const badges = [];
    if (context.isYouTubeVideo) {
      badges.push({ label: "YouTube watch page", variant: "primary" });
    }
    if (context.transcriptAvailable) {
      badges.push({ label: "Transcript available", variant: "primary" });
    } else if (context.isYouTubeVideo) {
      badges.push({ label: "Transcript unavailable", variant: "attention" });
    }
    if (context.hostname) {
      badges.push({ label: context.hostname });
    }

    return {
      title: context.title || "Current page",
      summary: context.isYouTubeVideo
        ? "ScriptLens stays transcript-first by default and keeps fallback controls tucked away until you need them."
        : "ScriptLens currently supports desktop YouTube watch pages only.",
      badges
    };
  }

  function buildReportViewModel(report, settings) {
    if (!report) {
      return null;
    }

    const acquisition = report.acquisition || {};
    const detection = report.detection || {};
    const score = Number(detection.aiScore ?? report.score ?? 0) || 0;
    const verdict = detection.verdict || report.verdict || "Unavailable";
    const palette = getScorePalette(score);
    const acquisitionQuality = formatAcquisitionQuality(acquisition);
    const acquisitionClass = acquisition?.quality || "weak-fallback";
    const inputLabel = report.inputQuality?.label || report.quality?.label || "Weak input";
    const providerLabel =
      acquisition.kind === "transcript"
        ? acquisition.providerClass === "backend"
          ? "Recovered transcript"
          : "Local transcript"
        : "Local content";
    const acquisitionStateNote =
      acquisition.kind === "transcript"
        ? acquisition.acquisitionState === "transcript-acquired"
          ? "ScriptLens analyzed a real transcript source."
          : acquisition.acquisitionState === "partial-transcript"
            ? "ScriptLens analyzed a real transcript source, but coverage or transcript quality was still limited."
            : acquisition.acquisitionState === "fallback-text-only"
              ? "This score came from title and description fallback, not the spoken transcript."
              : "ScriptLens could not retrieve a usable transcript before this analysis finished."
        : "";
    const sourceMeta = acquisition.kind === "transcript"
      ? [
          providerLabel,
          acquisition.isGenerated === true
            ? "Auto captions"
            : acquisition.isGenerated === false
              ? "Manual captions"
              : "",
          acquisition.languageCode ? `Language: ${acquisition.languageCode}` : ""
        ]
      : [
          formatSourceKind(acquisition.kind),
          acquisition.coverageRatio != null
            ? `${Math.round(acquisition.coverageRatio * 100)}% extraction coverage`
            : "",
          acquisition.languageCode || ""
        ];
    const confidenceMeta = [
      acquisition.isGenerated === true ? "Generated" : acquisition.isGenerated === false ? "Manual" : "",
      acquisition.coverageRatio != null
        ? `${Math.round(acquisition.coverageRatio * 100)}% coverage`
        : ""
    ].filter(Boolean);

    if (!confidenceMeta.length && acquisition.kind === "manual-input") {
      confidenceMeta.push("Direct pasted text");
    }
    if (!confidenceMeta.length && acquisition.kind === "selection") {
      confidenceMeta.push("Selected context only");
    }

    return {
      score,
      verdict,
      verdictClass: getVerdictClass(score),
      palette,
      acquisitionQuality,
      acquisitionClass,
      inputLabel,
      inputClass: toClassToken(inputLabel),
      explanation: detection.explanation || report.explanation || report.error || "",
      source: report.source || "Local analysis",
      counts: `${report.metadata?.wordCount || 0} words - ${report.metadata?.sentenceCount || 0} sentences`,
      meta: `Sensitivity: ${capitalize(report.metadata?.sensitivity || settings?.sensitivity || "medium")}`,
      sourceLabel: acquisition.sourceLabel || "Not applicable",
      sourceMeta: sourceMeta.filter(Boolean).join(" - "),
      sourceConfidence: capitalize(acquisition.sourceConfidence || "not applicable"),
      sourceConfidenceMeta: confidenceMeta.join(" - "),
      providerLabel,
      privacyDisclosure:
        acquisition.providerClass === "backend"
          ? "Only the video ID and requested language were sent to ScriptLens to retrieve the transcript."
          : "",
      acquisitionStateNote,
      detectorConfidence: capitalize(detection.detectorConfidence || "low"),
      detectorConfidenceMeta:
        acquisition.quality === "weak-fallback"
          ? "Detector confidence is capped because this score comes from title and description fallback."
          : "Detector confidence is capped by source confidence and sample size.",
      inputSummary: report.inputQuality?.summary || report.quality?.summary || "",
      interpretationMeans: report.interpretation?.means || "",
      interpretationNotMeans: report.interpretation?.notMeans || report.disclaimer || "",
      falsePositives: report.interpretation?.falsePositives || [],
      trustMore: report.interpretation?.trustMore || [],
      topReasons: report.topReasons || detection.reasons || [],
      categoryScores: report.categoryScores || detection.categoryScores || {},
      flaggedSentences: report.flaggedSentences || detection.flaggedSentences || [],
      debugVisible: Boolean(settings?.debugMode && report.acquisition),
      debugWinningPath: (report.acquisition?.resolverPath || []).join(" -> ") || "Not available",
      debugWinnerReason:
        (report.acquisition?.winnerSelectedBy || []).join(" | ") || "Single candidate",
      debugWarnings: (report.acquisition?.warnings || []).join(", ") || "None",
      debugErrors:
        (report.acquisition?.errors || [])
          .map((error) => `${error.strategy}:${error.code}`)
          .join(" | ") || "No resolver errors"
    };
  }

  function buildRecentReportsViewModel(recentReports) {
    return Array.isArray(recentReports) ? recentReports : [];
  }

  function buildInlineReportViewModel(report) {
    if (!report) {
      return null;
    }

    const acquisition = report.acquisition || {};
    const detection = report.detection || {};
    const score = Number(detection.aiScore ?? report.score ?? 0) || 0;
    const verdict = detection.verdict || report.verdict || "Unavailable";
    const scoreClass = getVerdictClass(score);
    const sourceLabel = getConsumerSourceLabel(acquisition);
    const qualityLabel = getConsumerQualityLabel(acquisition);
    const confidenceLabel = capitalize(acquisition.sourceConfidence || "low");
    const explanation =
      detection.explanation ||
      report.explanation ||
      "ScriptLens reviewed the available transcript material for this video.";
    const detailSummary =
      report.inputQuality?.summary ||
      report.quality?.summary ||
      "Use the full workspace for a deeper breakdown.";
    const transcriptMeta = []
      .concat(acquisition.isGenerated === true ? ["Auto captions"] : [])
      .concat(
        typeof acquisition.coverageRatio === "number"
          ? [`${Math.round(acquisition.coverageRatio * 100)}% coverage`]
          : []
      )
      .concat(acquisition.segmentCount ? [`${acquisition.segmentCount} segments`] : [])
      .concat(
        acquisition.transcriptSpanSeconds ? [`${Math.round(acquisition.transcriptSpanSeconds)}s span`] : []
      )
      .join(" - ");

    return {
      score,
      scoreClass,
      verdict,
      explanation,
      qualityLabel,
      sourceLabel,
      confidenceLabel,
      detailSummary,
      transcriptMeta,
      reasonPreview: (report.topReasons || detection.reasons || []).slice(0, 3),
      privacyDisclosure: getConsumerPrivacyDisclosure(acquisition),
      canShowDetails: Boolean(acquisition.kind === "transcript"),
      advancedSourceLabel: acquisition.sourceLabel || "Transcript",
      advancedSourceMeta: [
        acquisition.providerClass === "backend" ? "Advanced recovery" : "On-page retrieval",
        acquisition.languageCode || "unknown language"
      ]
        .filter(Boolean)
        .join(" - "),
      detectorConfidence: capitalize(detection.detectorConfidence || "low"),
      rawScoreText: `${score}/100`
    };
  }

  function getRequestLabel(request) {
    if (request?.mode === "selection") {
      return {
        title: "Analyze the live selection",
        copy: "Use only the highlighted passage from the current tab.",
        button: "Analyze Selection"
      };
    }
    if (request?.mode === "page") {
      return {
        title: "Analyze the visible page",
        copy: "Use the main readable content from the current tab.",
        button: "Analyze Page"
      };
    }
    if (request?.mode === "youtube") {
      return {
        title: "Analyze this video",
        copy: "Run a transcript-first check for AI-like writing patterns, with fallback controls available only if you need them.",
        button: "Analyze Video"
      };
    }
    if (request?.mode === "manual") {
      return {
        title: "Analyze pasted text",
        copy: "Use the manual input exactly as written.",
        button: "Analyze Pasted Text"
      };
    }
    return {
      title: "Choose a source",
      copy: "ScriptLens could not find a strong default source on this tab yet.",
      button: "Unavailable"
    };
  }

  function renderBadges(badges) {
    return (badges || [])
      .map((badge) => {
        const variant = badge.variant ? ` ${badge.variant}` : "";
        return `<span class="context-badge${variant}">${escapeHtml(badge.label)}</span>`;
      })
      .join("");
  }

  function getVerdictClass(score) {
    if (score >= 75) {
      return "high";
    }
    if (score >= 30) {
      return "mid";
    }
    return "low";
  }

  function getScorePalette(score) {
    if (score >= 75) {
      return {
        background: "#faeded",
        border: "#efc7c7",
        text: "#9d3f3f"
      };
    }
    if (score >= 30) {
      return {
        background: "#fbf4e8",
        border: "#e7d5b0",
        text: "#8a6326"
      };
    }
    return {
      background: "#edf6ef",
      border: "#cfe1d3",
      text: "#256444"
    };
  }

  function formatAcquisitionQuality(acquisition) {
    if (!acquisition?.quality) {
      return "Unavailable";
    }

    if (acquisition.kind !== "transcript") {
      if (acquisition.quality === "strong-transcript") {
        return "Strong content";
      }
      if (acquisition.quality === "partial-transcript") {
        return "Useful content";
      }
      if (acquisition.quality === "weak-fallback") {
        return "Weak content";
      }
    }

    if (acquisition.acquisitionState === "transcript-acquired") {
      return "Transcript acquired";
    }
    if (acquisition.acquisitionState === "partial-transcript") {
      return "Partial transcript";
    }
    if (acquisition.acquisitionState === "fallback-text-only") {
      return "Fallback text only";
    }
    if (acquisition.acquisitionState === "transcript-unavailable") {
      return "Transcript unavailable";
    }

    return acquisition.quality
      .split("-")
      .map((part) => capitalize(part))
      .join(" ");
  }

  function formatSourceKind(kind) {
    if (kind === "manual-input") {
      return "Manual input";
    }
    if (kind === "article-content") {
      return "Article content";
    }
    if (kind === "page-content") {
      return "Page content";
    }
    if (kind === "selection") {
      return "Selection";
    }
    return "Transcript";
  }

  function getConsumerSourceLabel(acquisition) {
    if (acquisition.kind !== "transcript") {
      return "Fallback video text";
    }
    if (acquisition.providerClass === "backend") {
      return "Recovered transcript";
    }
    if (acquisition.strategy === "title-description") {
      return "Title and description";
    }
    if (acquisition.isGenerated === true) {
      return "YouTube captions";
    }
    return "YouTube transcript";
  }

  function getConsumerQualityLabel(acquisition) {
    if (acquisition.acquisitionState === "transcript-acquired") {
      return "Strong transcript";
    }
    if (acquisition.acquisitionState === "partial-transcript") {
      return "Usable transcript";
    }
    if (acquisition.acquisitionState === "fallback-text-only") {
      return "Fallback text";
    }
    if (acquisition.acquisitionState === "transcript-unavailable") {
      return "Transcript unavailable";
    }
    return "Transcript check";
  }

  function getConsumerPrivacyDisclosure(acquisition) {
    if (acquisition.providerClass !== "backend") {
      return "";
    }

    return "To recover the transcript, ScriptLens only shared the video ID and requested language with your local helper.";
  }

  function formatCategoryName(key) {
    return String(key || "")
      .split(/[_-]/)
      .map((part) => capitalize(part))
      .join(" ");
  }

  function toClassToken(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, "-");
  }

  function capitalize(value) {
    const text = String(value || "");
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})(globalThis);
