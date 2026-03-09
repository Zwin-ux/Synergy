# ScriptLens

Open-source Chrome extension for transcript-first YouTube analysis.

ScriptLens is a Manifest V3 Chrome extension focused on one job: analyze the writing style of desktop YouTube video transcripts for AI-like patterns. The store-facing release is YouTube-only, inline-first, and local by default.

## What ships in the Chrome Web Store build

- A one-click inline `Analyze video` button on desktop `youtube.com/watch` pages
- A verdict-first inline result card with score, explanation, transcript quality, and an optional details drawer
- A toolbar popup and side-panel workspace for advanced transcript controls and deeper report breakdowns
- Optional local helper support for harder transcript recovery cases

## Product scope

- Supported: desktop `https://www.youtube.com/watch?...`
- Not supported in the store build: Shorts, `m.youtube.com`, generic page analysis, manual text analysis, or selection/page capture flows

## Open source

- License: [MIT](../LICENSE)
- Public repository: `https://github.com/Zwin-ux/Synergy`

## Runtime notes

- Scoring runs inside the extension with deterministic heuristics
- The extension is transcript-first by default
- Title and description fallback only happens when the user explicitly allows it
- If the optional local helper is used, ScriptLens only sends the YouTube video ID and requested language to that helper

## Repository layout

```text
ai-script-detector/
  manifest.json
  content.js
  service-worker.js
  youtube-main.js
  youtube-overlay.js
  popup.*
  sidepanel.*
  detector/
  transcript/
  surface/
  utils/
  docs/
  release/
  scripts/
  store-assets/
  tests/
```

## Load unpacked in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `ai-script-detector` folder.

## Optional local helper

The helper is advanced and optional. It is not included in the Chrome Web Store package.

### Windows setup

1. Install `yt-dlp` for your user profile:
   - `python -m pip install --user yt-dlp`
2. Set the helper command for future terminals:
   - `[Environment]::SetEnvironmentVariable("SCRIPTLENS_YTDLP_COMMAND", "$env:APPDATA\\Python\\Python311\\Scripts\\yt-dlp.exe", "User")`
3. Open a new terminal and start the helper:
   - `npm.cmd run backend:start`

You can also use `SCRIPTLENS_YTDLP_PYTHONPATH` and `SCRIPTLENS_YTDLP_PYTHON` instead of `SCRIPTLENS_YTDLP_COMMAND`.

More helper notes live in `release/README.md`.

## Development commands

- Install dependencies:
  - `npm.cmd install`
- Start the optional helper:
  - `npm.cmd run backend:start`
- Run the Playwright suite:
  - `npm.cmd run test:e2e`
- Run the YouTube smoke suite:
  - `npm.cmd run test:e2e:youtube`
- Build an unpacked release staging directory:
  - `npm.cmd run build:extension`
- Build the Chrome Web Store zip:
  - `npm.cmd run package:extension`

Release artifacts are written to `dist/chrome-unpacked` and `dist/packages`.

## Store and release assets

- GitHub Pages overview: `docs/index.html`
- Privacy policy: `docs/privacy.html`
- Support page: `docs/support.html`
- Store listing source text: `store-assets/store-listing.md`
- Screenshot checklist: `store-assets/screenshot-checklist.md`

## Permissions

- `storage` for settings and recent report summaries
- `sidePanel` for the advanced workspace
- Host access limited to `https://www.youtube.com/*`

## Validation focus

- Inline analyze stays inline until the user chooses `Open full workspace`
- Transcript quality and result confidence stay clearly separated
- Fallback text is labeled honestly and only used when explicitly enabled
- The release zip contains only extension runtime assets
- Privacy/support docs match the shipped behavior exactly
