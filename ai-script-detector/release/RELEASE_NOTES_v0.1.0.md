# ScriptLens v0.1.0 — Release Notes

## Release Assessment

**Extension package root:** `ai-script-detector/`

**Build output (unpacked):** `ai-script-detector/dist/chrome-unpacked/`

**Chrome Web Store ZIP:** `ai-script-detector/dist/packages/scriptlens-youtube-v0.1.0.zip`

The extension is built and packaged by running:

```
npm run build:extension    # stages to dist/chrome-unpacked/
npm run package:extension  # produces dist/packages/scriptlens-youtube-v0.1.0.zip
```

Both commands run as part of the `fast-checks` CI workflow and upload artifacts automatically.

---

## What's in This Release

ScriptLens v0.1.0 is the first shippable YouTube transcript analysis extension for the Chrome Web Store.

### Core capabilities

- **Inline analyze button** — one-click button injected directly on `youtube.com/watch` pages
- **Transcript-first scoring** — pulls the strongest available local transcript path before falling back
- **Verdict card** — compact AI-like writing score shown inline on the page
- **Toolbar popup** — full transcript controls, sensitivity settings, and result detail
- **Side-panel workspace** — detailed signal breakdown and flagged passage review
- **Optional transcript recovery backend** — compatible with the ScriptLens-hosted or self-hosted backend for hard caption-blocked videos

### What was ready

- All 67 deterministic CI tests pass (contracts, inline state, service worker, backend module, release build, release readiness, shared surface, backend server, transcript resolver, content/YouTube, staged QA, release readiness gate)
- Manifest v3 with correct permissions (`sidePanel`, `storage`), host permissions (`https://www.youtube.com/*`), and proper `service_worker`, `side_panel`, `action`, and `content_scripts` entries
- All manifest-referenced files verified present in build output
- Icons at all required sizes (16×16, 32×32, 48×48, 128×128)
- Defuddle QA corpus: 13/13 videos, 0 transcript regressions, 0 labeling issues
- Staged full QA: 11/18 backend successes, 18/18 inline compact runs, 0 transport issues
- `runtime-config.js` ships with backend disabled by default (`allowBackendTranscriptFallbackByDefault: false`)

### What was cleaned up

- Added missing deterministic tests (`staged-consumer-qa.spec.js`, `release-readiness.spec.js`) to the `fast-checks` CI workflow, aligning it with the `ci:fast` npm script
- Resolved placeholder support and privacy URLs in `store-assets/store-listing.md` with the live Railway public site URLs

---

## Packaging Result

| Field | Value |
|---|---|
| Folder packaged | `ai-script-detector/dist/chrome-unpacked/` |
| ZIP filename | `scriptlens-youtube-v0.1.0.zip` |
| ZIP produced at | `ai-script-detector/dist/packages/scriptlens-youtube-v0.1.0.zip` |
| Intentionally excluded | `backend/`, `tests/`, `scripts/`, `docs/`, `store-assets/`, `release/`, `node_modules/`, `playwright.config.js` |

The `dist/` directory is gitignored. The CI `fast-checks` workflow builds and packages the extension and uploads both artifacts (unpacked folder and ZIP) to `scriptlens-fast-check-artifacts`.

---

## Final Validation Checklist

Before submitting the ZIP to the Chrome Web Store, verify:

- [ ] Unzip `scriptlens-youtube-v0.1.0.zip` and load it as an unpacked extension in Chrome DevTools — no errors on load
- [ ] Navigate to a YouTube watch page and confirm the **Analyze video** button appears
- [ ] Click **Analyze video** — confirm a result card appears inline within a few seconds
- [ ] Open the toolbar popup — confirm transcript controls and settings render correctly
- [ ] Open the side-panel workspace via the popup — confirm detailed results display
- [ ] Check the Chrome extension DevTools console — no unhandled exceptions or missing-file 404s
- [ ] Confirm `manifest.json` version reads `0.1.0`
- [ ] Confirm icon appears correctly in Chrome toolbar at 16px and 48px sizes
- [ ] Confirm `runtime-config.js` has `defaultBackendTranscriptEndpoint: ""` (backend disabled by default)
- [ ] Confirm the ZIP does not contain `backend/`, `tests/`, `scripts/`, or `node_modules/`
- [ ] Privacy URL resolves: `https://synergy-production-b7bd.up.railway.app/privacy`
- [ ] Support URL resolves: `https://synergy-production-b7bd.up.railway.app/support`
- [ ] Screenshots for the store listing are captured per `store-assets/screenshot-checklist.md`

---

## Store-Facing Release Summary

**ScriptLens — first public release (v0.1.0)**

ScriptLens adds a single **Analyze video** button to YouTube watch pages. One click scores the video transcript for AI-like writing patterns using deterministic heuristics that run entirely inside your browser.

The inline result card shows a verdict and confidence level without leaving the page. For deeper review, the toolbar popup and side-panel workspace provide full signal breakdowns and flagged passage lists.

No data leaves your browser by default. If a compatible transcript recovery backend is configured, only the video ID and language are shared — never the transcript text.

Supports desktop YouTube watch pages only. Does not run on Shorts, search, or channel pages.
