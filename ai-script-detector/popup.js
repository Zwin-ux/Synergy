(function () {
  const state = {
    pageContext: null,
    lastReport: null,
    busy: false
  };

  const elements = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    bindEvents();
    showStatus("Loading ScriptLens...", "info");

    const response = await sendMessage({ type: "popup:init" });
    if (!response.ok) {
      showStatus(response.error || "Could not load ScriptLens.", "error");
      return;
    }

    state.pageContext = response.pageContext || null;
    state.lastReport = response.lastReport || null;

    renderPageContext();
    renderRecommendation();
    renderLastReport();
    clearStatus();
  }

  function cacheElements() {
    elements.pageContextTitle = document.getElementById("pageContextTitle");
    elements.pageContextSummary = document.getElementById("pageContextSummary");
    elements.pageContextBadges = document.getElementById("pageContextBadges");
    elements.recommendedActionTitle = document.getElementById("recommendedActionTitle");
    elements.recommendedActionCopy = document.getElementById("recommendedActionCopy");
    elements.recommendedActionButton = document.getElementById("recommendedActionButton");
    elements.openWorkspaceButton = document.getElementById("openWorkspaceButton");
    elements.quickSelectionButton = document.getElementById("quickSelectionButton");
    elements.quickPageButton = document.getElementById("quickPageButton");
    elements.quickTranscriptButton = document.getElementById("quickTranscriptButton");
    elements.statusBanner = document.getElementById("statusBanner");
    elements.lastReportEmpty = document.getElementById("lastReportEmpty");
    elements.lastReportCard = document.getElementById("lastReportCard");
    elements.lastScoreValue = document.getElementById("lastScoreValue");
    elements.lastVerdict = document.getElementById("lastVerdict");
    elements.lastSource = document.getElementById("lastSource");
    elements.lastQuality = document.getElementById("lastQuality");
    elements.lastPreview = document.getElementById("lastPreview");
  }

  function bindEvents() {
    elements.recommendedActionButton.addEventListener("click", () => {
      openWorkspace(getRecommendedRequest());
    });
    elements.openWorkspaceButton.addEventListener("click", () => {
      openWorkspace(null);
    });
    elements.quickSelectionButton.addEventListener("click", () => {
      openWorkspace({ mode: "selection" });
    });
    elements.quickPageButton.addEventListener("click", () => {
      openWorkspace({ mode: "page" });
    });
    elements.quickTranscriptButton.addEventListener("click", () => {
      openWorkspace({
        mode: "youtube",
        includeSources: ["transcript"]
      });
    });
  }

  async function openWorkspace(request) {
    if (state.busy) {
      return;
    }

    setBusy(true);
    showStatus("Opening workspace...", "info");

    const response = await sendMessage({
      type: "panel:open",
      request
    });

    setBusy(false);

    if (!response.ok) {
      showStatus(response.error || "Could not open the workspace.", "error");
      return;
    }

    window.close();
  }

  function renderPageContext() {
    const context = state.pageContext;
    const badges = [];

    if (!context?.supported) {
      elements.pageContextTitle.textContent = "Current page access is limited";
      elements.pageContextSummary.textContent =
        "Open a regular webpage or YouTube watch page to unlock richer capture.";
      elements.pageContextBadges.innerHTML = renderBadges([
        { label: "Restricted page", variant: "attention" }
      ]);
      elements.quickSelectionButton.disabled = true;
      elements.quickPageButton.disabled = true;
      elements.quickTranscriptButton.disabled = true;
      return;
    }

    elements.pageContextTitle.textContent = context.title || "Page ready";
    elements.pageContextSummary.textContent = context.isYouTubeVideo
      ? context.transcriptAvailable
        ? "This YouTube video has transcript-capable sources available."
        : "This YouTube video can still be analyzed from title and description context."
      : "ScriptLens can open a focused workspace for this page.";

    if (context.selectionAvailable) {
      badges.push({ label: "Selection ready" });
    }
    if (context.pageAvailable) {
      badges.push({ label: "Visible page ready" });
    }
    if (context.isYouTubeVideo) {
      badges.push({ label: "YouTube video", variant: "primary" });
    }
    if (context.transcriptAvailable) {
      badges.push({ label: "Transcript available", variant: "primary" });
    }
    if (context.hostname) {
      badges.push({ label: context.hostname });
    }

    elements.pageContextBadges.innerHTML = renderBadges(badges);
    elements.quickSelectionButton.disabled = state.busy || !context.selectionAvailable;
    elements.quickPageButton.disabled = state.busy || !context.pageAvailable;
    elements.quickTranscriptButton.disabled = state.busy || !context.transcriptAvailable;
  }

  function renderRecommendation() {
    const request = getRecommendedRequest();
    if (!request) {
      elements.recommendedActionTitle.textContent = "Open the workspace";
      elements.recommendedActionCopy.textContent =
        "Launch the side panel and choose a source there.";
      elements.recommendedActionButton.textContent = "Open Workspace";
      elements.recommendedActionButton.disabled = state.busy || !state.pageContext?.supported;
      return;
    }

    const label = getRequestLabel(request);
    elements.recommendedActionTitle.textContent = label.title;
    elements.recommendedActionCopy.textContent = label.copy;
    elements.recommendedActionButton.textContent = label.button;
    elements.recommendedActionButton.disabled = state.busy;
  }

  function renderLastReport() {
    const report = state.lastReport;
    if (!report) {
      elements.lastReportEmpty.classList.remove("hidden");
      elements.lastReportCard.classList.add("hidden");
      return;
    }

    elements.lastReportEmpty.classList.add("hidden");
    elements.lastReportCard.classList.remove("hidden");
    elements.lastScoreValue.textContent = String(report.score);
    elements.lastVerdict.textContent = report.verdict;
    elements.lastVerdict.className = `snapshot-verdict ${getVerdictClass(report.score)}`;
    elements.lastSource.textContent = report.source;
    elements.lastQuality.textContent = report.qualityLabel || "";
    elements.lastPreview.textContent = report.preview;
  }

  function getRecommendedRequest() {
    return state.pageContext?.recommendedRequest || null;
  }

  function getRequestLabel(request) {
    if (request.mode === "selection") {
      return {
        title: "Use the live selection",
        copy: "Open the workspace with the exact passage you already highlighted.",
        button: "Analyze Selection"
      };
    }

    if (request.mode === "page") {
      return {
        title: "Analyze the visible page",
        copy: "Open the workspace and inspect the main readable content from this tab.",
        button: "Analyze Page"
      };
    }

    if (request.mode === "youtube") {
      const sources = Array.isArray(request.includeSources) ? request.includeSources : [];
      return {
        title: "Analyze this video",
        copy: `Open the workspace with ${sources.join(" + ") || "video"} sources ready.`,
        button: "Analyze Video"
      };
    }

    return {
      title: "Open the workspace",
      copy: "Open the side panel and choose a source there.",
      button: "Open Workspace"
    };
  }

  function renderBadges(badges) {
    return badges
      .map((badge) => {
        const variant = badge.variant ? ` ${badge.variant}` : "";
        return `<span class="context-badge${variant}">${escapeHtml(badge.label)}</span>`;
      })
      .join("");
  }

  function setBusy(isBusy) {
    state.busy = isBusy;
    [
      elements.recommendedActionButton,
      elements.openWorkspaceButton,
      elements.quickSelectionButton,
      elements.quickPageButton,
      elements.quickTranscriptButton
    ].forEach((button) => {
      button.disabled = isBusy;
    });

    if (!isBusy) {
      renderPageContext();
      renderRecommendation();
    }
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

  function showStatus(message, kind) {
    elements.statusBanner.textContent = message;
    elements.statusBanner.className = `status-banner ${kind || "info"}`;
  }

  function clearStatus() {
    elements.statusBanner.textContent = "";
    elements.statusBanner.className = "status-banner hidden";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function sendMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      return {
        ok: false,
        error: error?.message || "Extension messaging failed."
      };
    }
  }
})();
