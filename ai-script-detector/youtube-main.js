(function () {
  if (globalThis.__scriptLensYouTubeMainLoaded) {
    return;
  }

  globalThis.__scriptLensYouTubeMainLoaded = true;

  const SNAPSHOT_ATTRIBUTE = "data-scriptlens-caption-snapshot";
  const REQUEST_EVENT = "scriptlens:request-caption-snapshot";
  const READY_EVENT = "scriptlens:caption-snapshot-ready";
  let refreshTimer = 0;

  init();

  function init() {
    writeSnapshot();
    scheduleRefreshBurst();

    document.addEventListener(REQUEST_EVENT, handleSnapshotRequest);
    window.addEventListener("yt-navigate-start", scheduleRefreshBurst);
    window.addEventListener("yt-navigate-finish", scheduleRefreshBurst);
    window.addEventListener("yt-page-data-updated", scheduleRefreshBurst);
    window.addEventListener("load", scheduleRefreshBurst);
  }

  function handleSnapshotRequest() {
    writeSnapshot();
  }

  function scheduleRefreshBurst() {
    clearTimeout(refreshTimer);
    writeSnapshot();

    const delays = [180, 800, 1800];
    delays.forEach((delay) => {
      refreshTimer = window.setTimeout(writeSnapshot, delay);
    });
  }

  function writeSnapshot() {
    const root = document.documentElement;
    if (!root) {
      return;
    }

    const snapshot = readCaptionSnapshot();
    try {
      root.setAttribute(SNAPSHOT_ATTRIBUTE, JSON.stringify(snapshot));
    } catch (error) {
      root.removeAttribute(SNAPSHOT_ATTRIBUTE);
    }

    window.dispatchEvent(new CustomEvent(READY_EVENT));
  }

  function readCaptionSnapshot() {
    const rawPlayerResponse =
      globalThis.ytInitialPlayerResponse ||
      globalThis.ytplayer?.config?.args?.raw_player_response ||
      globalThis.ytplayer?.config?.args?.player_response ||
      null;

    let playerResponse = rawPlayerResponse;
    if (typeof playerResponse === "string") {
      try {
        playerResponse = JSON.parse(playerResponse);
      } catch (error) {
        playerResponse = null;
      }
    }

    return {
      captionTracks:
        playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [],
      updatedAt: Date.now()
    };
  }
})();
