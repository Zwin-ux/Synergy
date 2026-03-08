(function () {
  const DEFAULT_SETTINGS = {
    sensitivity: "medium",
    maxTextLength: 18000
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    recentReports: [],
    pageContext: null,
    sitePreference: {},
    uiHints: {},
    currentReport: null,
    videoSelection: {
      includeSources: [],
      trackBaseUrl: ""
    },
    busy: false,
    activeTabId: null,
    lastHandledLaunchAt: 0,
    refreshTimer: 0,
    targetContext: readTargetContext()
  };

  const elements = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    bindEvents();
    updateManualMeta();
    showStatus("Loading workspace...", "info");

    await refreshWorkspace(false);
    registerExtensionListeners();
    clearStatus();
  }

  function cacheElements() {
    elements.statusBanner = document.getElementById("statusBanner");
    elements.pageTitle = document.getElementById("pageTitle");
    elements.pageSummary = document.getElementById("pageSummary");
    elements.pageBadges = document.getElementById("pageBadges");
    elements.onboardingSection = document.getElementById("onboardingSection");
    elements.onboardingList = document.getElementById("onboardingList");
    elements.recommendedActionTitle = document.getElementById("recommendedActionTitle");
    elements.recommendedActionCopy = document.getElementById("recommendedActionCopy");
    elements.recommendedActionButton = document.getElementById("recommendedActionButton");
    elements.analyzeSelectionButton = document.getElementById("analyzeSelectionButton");
    elements.analyzePageButton = document.getElementById("analyzePageButton");
    elements.openWorkspaceButton = document.getElementById("openWorkspaceButton");
    elements.youtubeControls = document.getElementById("youtubeControls");
    elements.videoSourceChips = document.getElementById("videoSourceChips");
    elements.trackField = document.getElementById("trackField");
    elements.trackSelect = document.getElementById("trackSelect");
    elements.manualInput = document.getElementById("manualInput");
    elements.analyzeManualButton = document.getElementById("analyzeManualButton");
    elements.clearManualButton = document.getElementById("clearManualButton");
    elements.manualMeta = document.getElementById("manualMeta");
    elements.sensitivitySelect = document.getElementById("sensitivitySelect");
    elements.maxTextLengthInput = document.getElementById("maxTextLengthInput");
    elements.saveSettingsButton = document.getElementById("saveSettingsButton");
    elements.resultPanel = document.getElementById("resultPanel");
    elements.resultEmpty = document.getElementById("resultEmpty");
    elements.resultContent = document.getElementById("resultContent");
    elements.scoreBadge = document.getElementById("scoreBadge");
    elements.scoreValue = document.getElementById("scoreValue");
    elements.verdictBadge = document.getElementById("verdictBadge");
    elements.qualityBadge = document.getElementById("qualityBadge");
    elements.reportExplanation = document.getElementById("reportExplanation");
    elements.reportSource = document.getElementById("reportSource");
    elements.reportCounts = document.getElementById("reportCounts");
    elements.reportMeta = document.getElementById("reportMeta");
    elements.qualitySummary = document.getElementById("qualitySummary");
    elements.trustMeans = document.getElementById("trustMeans");
    elements.trustNotMeans = document.getElementById("trustNotMeans");
    elements.falsePositiveList = document.getElementById("falsePositiveList");
    elements.trustMoreList = document.getElementById("trustMoreList");
    elements.categoryGrid = document.getElementById("categoryGrid");
    elements.topReasonsList = document.getElementById("topReasonsList");
    elements.flaggedCount = document.getElementById("flaggedCount");
    elements.flaggedSentencesList = document.getElementById("flaggedSentencesList");
    elements.recentReportsList = document.getElementById("recentReportsList");
  }

  function bindEvents() {
    elements.recommendedActionButton.addEventListener("click", () => {
      analyzeRequest(getRecommendedRequest());
    });
    elements.analyzeSelectionButton.addEventListener("click", () => {
      analyzeRequest({ mode: "selection" });
    });
    elements.analyzePageButton.addEventListener("click", () => {
      analyzeRequest({ mode: "page" });
    });
    elements.openWorkspaceButton.addEventListener("click", () => {
      refreshWorkspace(true);
    });
    elements.videoSourceChips.addEventListener("click", handleVideoChipClick);
    elements.trackSelect.addEventListener("change", () => {
      state.videoSelection.trackBaseUrl = elements.trackSelect.value;
      if (state.videoSelection.includeSources.includes("transcript")) {
        analyzeRequest(getCurrentVideoRequest());
      }
    });
    elements.manualInput.addEventListener("input", updateManualMeta);
    elements.analyzeManualButton.addEventListener("click", () => {
      analyzeRequest({
        mode: "manual",
        text: elements.manualInput.value
      });
    });
    elements.clearManualButton.addEventListener("click", () => {
      elements.manualInput.value = "";
      updateManualMeta();
      elements.manualInput.focus();
    });
    elements.saveSettingsButton.addEventListener("click", saveSettings);
    elements.onboardingList.addEventListener("click", handleHintClick);
  }

  function registerExtensionListeners() {
    chrome.tabs.onActivated.addListener(() => {
      scheduleRefresh();
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (!tab.active) {
        return;
      }

      if (changeInfo.status === "complete" || changeInfo.url) {
        scheduleRefresh();
      }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "session" && changes.panelLaunchRequest?.newValue) {
        handleLaunchRequest(changes.panelLaunchRequest.newValue);
      }
    });
  }

  function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => {
      refreshWorkspace(false);
    }, 200);
  }

  async function refreshWorkspace(preserveReport) {
    const response = await sendMessage({
      type: "panel:init",
      ...getTargetContextPayload()
    });
    if (!response.ok) {
      showStatus(response.error || "Could not load the workspace.", "error");
      return;
    }

    const nextTabId = response.pageContext?.tabId || null;
    const tabChanged = nextTabId !== null && nextTabId !== state.activeTabId;

    state.settings = {
      ...DEFAULT_SETTINGS,
      ...(response.settings || {})
    };
    state.recentReports = response.recentReports || [];
    state.pageContext = response.pageContext || null;
    state.sitePreference = response.sitePreference || {};
    state.uiHints = response.uiHints || {};
    state.activeTabId = nextTabId;

    if (tabChanged && !preserveReport) {
      state.currentReport = null;
    }

    syncVideoSelection(!tabChanged && preserveReport);
    applySettings();
    renderWorkspace();

    if (response.launchRequest) {
      handleLaunchRequest(response.launchRequest);
    }
  }

  function renderWorkspace() {
    renderPageContext();
    renderRecommendedAction();
    renderSourceControls();
    renderOnboardingHints();
    renderReport();
    renderRecentReports();
  }

  function renderPageContext() {
    const context = state.pageContext;
    const badges = [];

    if (!context?.supported) {
      elements.pageTitle.textContent = "Current page access is limited";
      elements.pageSummary.textContent =
        "Open a regular webpage or a YouTube watch page to unlock richer capture and analysis.";
      elements.pageBadges.innerHTML = renderBadges([
        { label: "Restricted page", variant: "attention" }
      ]);
      return;
    }

    elements.pageTitle.textContent = context.title || "Current page";
    elements.pageSummary.textContent = context.isYouTubeVideo
      ? context.transcriptAvailable
        ? "This video supports transcript-aware analysis and source switching."
        : "This video can still be analyzed from description and title context."
      : "Use selection, page capture, or manual input to inspect the current tab.";

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

    elements.pageBadges.innerHTML = renderBadges(badges);
  }

  function renderRecommendedAction() {
    const request = getRecommendedRequest();
    if (!request) {
      elements.recommendedActionTitle.textContent = "Choose a source";
      elements.recommendedActionCopy.textContent =
        "ScriptLens could not find a strong default source on this tab yet.";
      elements.recommendedActionButton.textContent = "Unavailable";
      elements.recommendedActionButton.disabled = true;
      return;
    }

    const label = getRequestLabel(request);
    elements.recommendedActionTitle.textContent = label.title;
    elements.recommendedActionCopy.textContent = label.copy;
    elements.recommendedActionButton.textContent = label.button;
    elements.recommendedActionButton.disabled = state.busy;
  }

  function renderSourceControls() {
    const context = state.pageContext;
    const isSupported = Boolean(context?.supported);

    elements.analyzeSelectionButton.disabled = state.busy || !context?.selectionAvailable;
    elements.analyzePageButton.disabled = state.busy || !context?.pageAvailable;
    elements.openWorkspaceButton.disabled = state.busy;

    if (!isSupported || !context.isYouTubeVideo || !context.video) {
      elements.youtubeControls.classList.add("hidden");
      return;
    }

    elements.youtubeControls.classList.remove("hidden");
    renderVideoSourceChips(context.video.availableSources || {});
    renderTrackSelector(context.video.transcriptTracks || []);
  }

  function renderVideoSourceChips(availableSources) {
    const labels = {
      transcript: "Transcript",
      description: "Description",
      title: "Title"
    };

    elements.videoSourceChips.innerHTML = ["transcript", "description", "title"]
      .map((source) => {
        const active = state.videoSelection.includeSources.includes(source) ? " active" : "";
        const disabled = availableSources[source] ? "" : " disabled";
        return `
          <button class="chip-button${active}" type="button" data-source="${source}"${disabled}>
            ${labels[source]}
          </button>
        `;
      })
      .join("");
  }

  function renderTrackSelector(tracks) {
    const transcriptSelected = state.videoSelection.includeSources.includes("transcript");
    if (!transcriptSelected || !tracks.length) {
      elements.trackField.classList.add("hidden");
      return;
    }

    elements.trackField.classList.remove("hidden");
    elements.trackSelect.innerHTML = tracks
      .map((track) => {
        const selected = track.baseUrl === state.videoSelection.trackBaseUrl ? " selected" : "";
        return `<option value="${escapeHtml(track.baseUrl)}"${selected}>${escapeHtml(track.label)}</option>`;
      })
      .join("");
  }

  function renderOnboardingHints() {
    const hints = [];
    const isYouTube = Boolean(state.pageContext?.isYouTubeVideo);
    const qualityScore = state.currentReport?.quality?.score || 0;

    if (!state.uiHints.sidePanelIntroDismissed) {
      hints.push({
        key: "sidePanelIntroDismissed",
        title: "How the workspace works",
        body:
          "Use the recommended action first, then switch sources if you want to compare how the score changes."
      });
    }

    if (isYouTube && !state.uiHints.youtubeIntroDismissed) {
      hints.push({
        key: "youtubeIntroDismissed",
        title: "YouTube source switching",
        body:
          "Transcript is usually the cleanest starting point. Add description or title when you want more authored context."
      });
    }

    if (state.currentReport && qualityScore < 50 && !state.uiHints.lowQualityHintDismissed) {
      hints.push({
        key: "lowQualityHintDismissed",
        title: "This input is weaker",
        body:
          "Short excerpts, noisy page capture, or missing transcripts make the score more directional and less stable."
      });
    }

    if (!hints.length) {
      elements.onboardingSection.classList.add("hidden");
      elements.onboardingList.innerHTML = "";
      return;
    }

    elements.onboardingSection.classList.remove("hidden");
    elements.onboardingList.innerHTML = hints
      .map((hint) => {
        return `
          <article class="hint-card">
            <div class="hint-top">
              <div>
                <strong class="hint-title">${escapeHtml(hint.title)}</strong>
                <div class="hint-copy">${escapeHtml(hint.body)}</div>
              </div>
              <button class="dismiss-button" type="button" data-hint-key="${hint.key}">
                Dismiss
              </button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderReport() {
    const report = state.currentReport;
    if (!report) {
      elements.resultPanel.classList.add("empty-state");
      elements.resultEmpty.classList.remove("hidden");
      elements.resultContent.classList.add("hidden");
      return;
    }

    const quality = report.quality || {};
    const interpretation = report.interpretation || {};

    elements.resultPanel.classList.remove("empty-state");
    elements.resultEmpty.classList.add("hidden");
    elements.resultContent.classList.remove("hidden");

    elements.scoreValue.textContent = String(report.score);
    elements.verdictBadge.textContent = report.verdict;
    elements.verdictBadge.className = `verdict-badge ${getVerdictClass(report.score)}`;
    elements.qualityBadge.textContent = quality.label || "Input quality";
    elements.qualityBadge.className = `quality-badge ${getQualityClass(quality.label)}`;
    elements.reportExplanation.textContent = report.explanation || "";
    elements.reportSource.textContent = report.source || "Local analysis";
    elements.reportCounts.textContent = `${report.metadata?.wordCount || 0} words - ${report.metadata?.sentenceCount || 0} sentences`;
    elements.reportMeta.textContent = `Sensitivity: ${capitalize(report.metadata?.sensitivity || state.settings.sensitivity)}`;
    elements.flaggedCount.textContent = `${(report.flaggedSentences || []).length} flagged`;

    const scorePalette = getScorePalette(report.score);
    elements.scoreBadge.style.background = scorePalette.background;
    elements.scoreBadge.style.borderColor = scorePalette.border;
    elements.scoreValue.style.color = scorePalette.text;

    elements.qualitySummary.textContent = quality.summary || "";
    elements.trustMeans.textContent = interpretation.means || "";
    elements.trustNotMeans.textContent = interpretation.notMeans || "";
    renderBulletList(elements.falsePositiveList, interpretation.falsePositives || []);
    renderBulletList(elements.trustMoreList, interpretation.trustMore || []);
    renderCategoryGrid(report.categoryScores || {});
    renderReasonList(report.topReasons || []);
    renderFlaggedSentences(report.flaggedSentences || []);
  }

  function renderCategoryGrid(categoryScores) {
    const entries = Object.entries(categoryScores).sort((left, right) => right[1] - left[1]);
    elements.categoryGrid.innerHTML = entries
      .map(([key, value]) => {
        return `
          <article class="signal-row">
            <div class="signal-meta">
              <strong>${formatCategoryName(key)}</strong>
              <span>${value}/100</span>
            </div>
            <div class="signal-track">
              <div class="signal-fill" style="width: ${Math.max(0, Math.min(100, value))}%"></div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderReasonList(reasons) {
    if (!reasons.length) {
      elements.topReasonsList.innerHTML =
        '<li class="empty-list">No strong category-level signals were triggered.</li>';
      return;
    }

    elements.topReasonsList.innerHTML = reasons
      .map((reason) => `<li class="reason-item">${escapeHtml(reason)}</li>`)
      .join("");
  }

  function renderFlaggedSentences(flags) {
    if (!flags.length) {
      elements.flaggedSentencesList.innerHTML =
        '<li class="empty-list">No individual sentence stood out enough to flag.</li>';
      return;
    }

    elements.flaggedSentencesList.innerHTML = flags
      .map((flag) => {
        const reasons = (flag.reasons || [])
          .map((reason) => `<span class="flag-reason">${escapeHtml(reason)}</span>`)
          .join("");

        return `
          <li class="flag-item">
            <strong>Sentence ${flag.sentenceNumber} - severity ${flag.severity}</strong>
            <p>${escapeHtml(flag.sentence)}</p>
            <div class="flag-reasons">${reasons}</div>
          </li>
        `;
      })
      .join("");
  }

  function renderRecentReports() {
    if (!state.recentReports.length) {
      elements.recentReportsList.innerHTML =
        '<li class="empty-list">Recent reports will appear here after analysis.</li>';
      return;
    }

    elements.recentReportsList.innerHTML = state.recentReports
      .map((report) => {
        return `
          <li class="recent-item">
            <strong>${escapeHtml(report.source)}</strong>
            <span class="recent-pill">${report.score}/100 - ${escapeHtml(report.verdict)}</span>
            <span>${escapeHtml(report.preview)}</span>
            <span>${escapeHtml(report.qualityLabel || "")}</span>
          </li>
        `;
      })
      .join("");
  }

  function renderBulletList(element, items) {
    if (!items.length) {
      element.innerHTML = '<li class="empty-list">No additional notes.</li>';
      return;
    }

    element.innerHTML = items
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
  }

  function syncVideoSelection(preserveCurrentSelection) {
    const video = state.pageContext?.video;
    if (!video) {
      state.videoSelection = {
        includeSources: [],
        trackBaseUrl: ""
      };
      return;
    }

    const defaultPreset = video.defaultPreset || {
      includeSources: video.availableSources?.transcript
        ? ["transcript"]
        : [video.availableSources?.description ? "description" : null, video.availableSources?.title ? "title" : null].filter(Boolean),
      trackBaseUrl: video.defaultTrackBaseUrl || ""
    };

    let includeSources = preserveCurrentSelection
      ? state.videoSelection.includeSources.filter((source) => video.availableSources?.[source])
      : [];

    if (!includeSources.length) {
      includeSources = defaultPreset.includeSources || [];
    }

    const trackOptions = video.transcriptTracks || [];
    let trackBaseUrl = preserveCurrentSelection ? state.videoSelection.trackBaseUrl : "";
    if (!trackOptions.find((track) => track.baseUrl === trackBaseUrl)) {
      trackBaseUrl = defaultPreset.trackBaseUrl || trackOptions[0]?.baseUrl || "";
    }

    state.videoSelection = {
      includeSources,
      trackBaseUrl
    };
  }

  function getRecommendedRequest() {
    return state.pageContext?.recommendedRequest || null;
  }

  function getCurrentVideoRequest() {
    return {
      mode: "youtube",
      includeSources: state.videoSelection.includeSources.slice(),
      trackBaseUrl: state.videoSelection.trackBaseUrl
    };
  }

  function handleVideoChipClick(event) {
    const button = event.target.closest("[data-source]");
    if (!button || button.disabled) {
      return;
    }

    const source = button.getAttribute("data-source");
    const current = new Set(state.videoSelection.includeSources);
    if (current.has(source) && current.size === 1) {
      return;
    }

    if (current.has(source)) {
      current.delete(source);
    } else {
      current.add(source);
    }

    state.videoSelection.includeSources = Array.from(current);
    renderSourceControls();
    analyzeRequest(getCurrentVideoRequest());
  }

  async function handleHintClick(event) {
    const button = event.target.closest("[data-hint-key]");
    if (!button) {
      return;
    }

    const key = button.getAttribute("data-hint-key");
    const response = await sendMessage({
      type: "uiHints:update",
      updates: {
        [key]: true
      }
    });

    if (!response.ok) {
      showStatus(response.error || "Could not update hints.", "error");
      return;
    }

    state.uiHints = response.uiHints || state.uiHints;
    renderOnboardingHints();
  }

  async function saveSettings() {
    showStatus("Saving settings...", "info");

    const response = await sendMessage({
      type: "settings:update",
      ...getTargetContextPayload(),
      settings: {
        sensitivity: elements.sensitivitySelect.value,
        maxTextLength: Number(elements.maxTextLengthInput.value)
      }
    });

    if (!response.ok) {
      showStatus(response.error || "Could not save settings.", "error");
      return;
    }

    state.settings = {
      ...DEFAULT_SETTINGS,
      ...(response.settings || {})
    };
    applySettings();
    showStatus("Settings saved locally.", "success");
  }

  async function analyzeRequest(request) {
    if (state.busy || !request) {
      return;
    }

    setBusy(true);
    showStatus("Running analysis...", "info");

    const response = await sendMessage({
      type: "panel:analyze",
      ...getTargetContextPayload(),
      request
    });

    setBusy(false);

    if (!response.ok) {
      showStatus(response.error || "Analysis failed.", "error");
      return;
    }

    state.currentReport = response.report || null;
    state.recentReports = response.recentReports || [];
    state.pageContext = response.pageContext || state.pageContext;
    state.sitePreference = response.sitePreference || state.sitePreference;
    state.uiHints = response.uiHints || state.uiHints;
    state.settings = {
      ...DEFAULT_SETTINGS,
      ...(response.settings || state.settings)
    };
    state.activeTabId = state.pageContext?.tabId || state.activeTabId;

    if (request.mode === "youtube") {
      state.videoSelection = {
        includeSources: (request.includeSources || []).slice(),
        trackBaseUrl: request.trackBaseUrl || ""
      };
    }

    applySettings();
    syncVideoSelection(true);
    renderWorkspace();
    showStatus("Analysis complete.", "success");
  }

  async function handleLaunchRequest(launchRequest) {
    if (!launchRequest?.request || !launchRequest.createdAt) {
      return;
    }

    if (launchRequest.createdAt <= state.lastHandledLaunchAt) {
      return;
    }

    state.lastHandledLaunchAt = launchRequest.createdAt;
    await analyzeRequest(launchRequest.request);
  }

  function applySettings() {
    elements.sensitivitySelect.value = state.settings.sensitivity;
    elements.maxTextLengthInput.value = state.settings.maxTextLength;
  }

  function updateManualMeta() {
    const text = elements.manualInput.value.trim();
    const wordCount = text ? text.split(/\s+/).length : 0;
    const charCount = text.length;
    elements.manualMeta.textContent = `${wordCount} words - ${charCount} chars`;
  }

  function setBusy(isBusy) {
    state.busy = isBusy;
    [
      elements.recommendedActionButton,
      elements.analyzeSelectionButton,
      elements.analyzePageButton,
      elements.openWorkspaceButton,
      elements.trackSelect,
      elements.analyzeManualButton,
      elements.clearManualButton,
      elements.saveSettingsButton
    ].forEach((element) => {
      element.disabled = isBusy;
    });

    if (!isBusy) {
      renderRecommendedAction();
      renderSourceControls();
    }
  }

  function renderBadges(badges) {
    return badges
      .map((badge) => {
        const variant = badge.variant ? ` ${badge.variant}` : "";
        return `<span class="context-badge${variant}">${escapeHtml(badge.label)}</span>`;
      })
      .join("");
  }

  function getRequestLabel(request) {
    if (request.mode === "selection") {
      return {
        title: "Use the live selection",
        copy: "Analyze the highlighted passage without unrelated page content.",
        button: "Analyze Selection"
      };
    }

    if (request.mode === "page") {
      return {
        title: "Analyze the visible page",
        copy: "Use the main readable page content and ignore most browser chrome.",
        button: "Analyze Page"
      };
    }

    if (request.mode === "youtube") {
      const sources = (request.includeSources || []).join(" + ");
      return {
        title: "Analyze this video",
        copy: `Use ${sources || "video"} sources and keep switching inside the workspace.`,
        button: "Analyze Video"
      };
    }

    if (request.mode === "manual") {
      return {
        title: "Analyze pasted text",
        copy: "Use the manual input exactly as written in the workspace.",
        button: "Analyze Pasted Text"
      };
    }

    return {
      title: "Choose a source",
      copy: "Select a source before running analysis.",
      button: "Analyze"
    };
  }

  function getVerdictClass(score) {
    if (score >= 75) {
      return "verdict-high";
    }
    if (score >= 30) {
      return "verdict-mid";
    }
    return "verdict-low";
  }

  function getQualityClass(label) {
    if (label === "Strong input") {
      return "quality-strong";
    }
    if (label === "Useful input") {
      return "quality-useful";
    }
    return "quality-weak";
  }

  function getScorePalette(score) {
    if (score >= 75) {
      return {
        background: "#fbefef",
        border: "#efc8c8",
        text: "#a23a3a"
      };
    }
    if (score >= 50) {
      return {
        background: "#fcf5ea",
        border: "#ecdcb8",
        text: "#8a6420"
      };
    }
    if (score >= 30) {
      return {
        background: "#f5f1ea",
        border: "#ded2c4",
        text: "#6f614e"
      };
    }
    return {
      background: "#edf7f1",
      border: "#cfe6d8",
      text: "#236847"
    };
  }

  function formatCategoryName(key) {
    return key
      .split(/[_-]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function capitalize(value) {
    const text = String(value || "");
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
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

  function readTargetContext() {
    const params = new URLSearchParams(window.location.search);
    const tabId = Number(params.get("targetTabId"));
    const windowId = Number(params.get("targetWindowId"));

    return {
      tabId: Number.isFinite(tabId) ? tabId : null,
      windowId: Number.isFinite(windowId) ? windowId : null
    };
  }

  function getTargetContextPayload() {
    return state.targetContext?.tabId
      ? {
          tabId: state.targetContext.tabId,
          windowId: state.targetContext.windowId
        }
      : {};
  }
})();
