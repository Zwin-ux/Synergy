(function () {
  if (globalThis.__scriptLensYouTubeOverlayLoaded) {
    return;
  }

  globalThis.__scriptLensYouTubeOverlayLoaded = true;

  const ROOT_ID = "scriptlens-youtube-cta-root";
  let renderTimer = 0;

  init();

  function init() {
    render();
    window.addEventListener("yt-navigate-finish", scheduleRender);
    window.addEventListener("yt-page-data-updated", scheduleRender);

    const observer = new MutationObserver(() => {
      scheduleRender();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = window.setTimeout(render, 180);
  }

  function render() {
    if (!isWatchPage()) {
      removeRoot();
      return;
    }

    const mountTarget = findMountTarget();
    if (!mountTarget) {
      return;
    }

    const root = ensureRoot(mountTarget);
    if (!root.shadowRoot) {
      root.attachShadow({ mode: "open" });
    }

    root.shadowRoot.innerHTML = `
      <style>
        :host {
          all: initial;
        }
        .wrap {
          margin-top: 10px;
          font-family: "Segoe UI", Aptos, sans-serif;
        }
        .button {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid #cbd5e1;
          border-radius: 999px;
          background: #ffffff;
          color: #22314c;
          padding: 9px 14px;
          font-size: 12px;
          font-weight: 700;
          line-height: 1;
          cursor: pointer;
        }
        .button:hover {
          background: #f8fafc;
          border-color: #aebbcf;
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #4a88e9;
        }
      </style>
      <div class="wrap">
        <button class="button" type="button" aria-label="Analyze this video with ScriptLens">
          <span class="dot"></span>
          Analyze this video
        </button>
      </div>
    `;

    const button = root.shadowRoot.querySelector(".button");
    button.addEventListener("click", handleClick, { once: true });
  }

  async function handleClick() {
    try {
      await chrome.runtime.sendMessage({
        type: "panel:open",
        request: {
          mode: "recommended"
        }
      });
    } catch (error) {
      if (!/Extension context invalidated/i.test(String(error?.message || ""))) {
        console.warn("ScriptLens could not open the workspace.", error);
      }
    } finally {
      scheduleRender();
    }
  }

  function ensureRoot(mountTarget) {
    let root = document.getElementById(ROOT_ID);
    if (root && root.parentElement !== mountTarget) {
      root.remove();
      root = null;
    }

    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      mountTarget.appendChild(root);
    }

    return root;
  }

  function removeRoot() {
    document.getElementById(ROOT_ID)?.remove();
  }

  function findMountTarget() {
    const selectors = [
      "#above-the-fold #top-row",
      "#above-the-fold #owner",
      "ytd-watch-metadata #actions",
      "#title h1"
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    }

    return null;
  }

  function isWatchPage() {
    const host = String(location.hostname || "").replace(/^www\./, "");
    return (
      host === "youtube.com" &&
      location.pathname === "/watch" &&
      Boolean(new URLSearchParams(location.search).get("v"))
    );
  }
})();
