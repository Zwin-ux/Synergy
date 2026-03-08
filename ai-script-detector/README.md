# ScriptLens

ScriptLens is a Manifest V3 Chrome extension for local, explainable AI-like writing analysis. It never sends text to a remote API or backend. All scoring runs inside the extension with deterministic heuristics.

## Premium workspace model

- Popup launcher for current-tab context, recommended action, and last result snapshot
- Persistent side panel workspace for full reports, source switching, trust guidance, and history
- YouTube-first workflow with an inline `Analyze this video` entry point on watch pages
- Local storage for settings, site preferences, onboarding state, and recent report summaries

## Core capabilities

- Analyze selected text from the active page
- Analyze visible page text with basic layout-noise filtering
- Paste text directly into the workspace
- Analyze YouTube videos from transcript, description, title, or combined source presets
- Show a `0-100` AI-likelihood score, verdict, top reasons, category scores, and flagged sentences
- Show separate input-quality guidance so weak sources do not look more certain than they are

## Project structure

```text
ai-script-detector/
  manifest.json
  popup.html
  popup.css
  popup.js
  sidepanel.html
  sidepanel.css
  sidepanel.js
  service-worker.js
  content.js
  youtube-main.js
  youtube-overlay.js
  package.json
  playwright.config.js
  tests/
  detector/
    analyze.js
    heuristics.js
    scoring.js
    patterns.js
  utils/
    text.js
    stats.js
    dom.js
  icons/
  README.md
```

## How scoring works

ScriptLens uses weighted local heuristics instead of a fake model. The final score combines:

- Repetition signals such as repeated phrases, transitions, and sentence openings
- Uniformity signals such as unusually consistent sentence or paragraph lengths
- Genericity signals such as vague claims, filler marketing language, and stock phrasing
- Script-template signals such as intro hooks, recap patterns, and creator CTA structures
- Specificity deficit signals such as low concrete detail and weak named-entity density
- Burstiness checks for low structural variance across nearby sentences

The detector returns category subscores, triggered patterns, top reasons, and flagged sentences so the output is explainable.

## Permissions

- `activeTab`, `scripting`, and `storage` for standard page capture flows
- `sidePanel` for the workspace surface
- YouTube host permissions only:
  - `https://www.youtube.com/*`
  - `https://m.youtube.com/*`

Non-YouTube tabs still rely on `activeTab` instead of broad site access.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `ai-script-detector` folder.

## E2E testing

ScriptLens now includes a Playwright harness for MV3 extension testing.

1. Install dependencies:
   - `npm.cmd install`
2. Install the bundled Chromium browser:
   - `npx.cmd playwright install chromium`
3. Run the YouTube smoke test against the default sample video:
   - `npm.cmd run test:e2e:youtube`
4. Run the full E2E suite:
   - `npm.cmd run test:e2e`

The Playwright harness uses a persistent Chromium context and loads the unpacked extension directly, which matches the official Playwright extension-testing model.

## Recommended usage

1. Click the ScriptLens toolbar icon.
2. Use the recommended action from the popup.
3. Review the full report in the side panel.
4. On YouTube, click `Analyze this video` or switch transcript, description, and title sources in the workspace.

## Notes

- Recent reports store summaries only, not full source text.
- The score reflects AI-like writing patterns, not proof of authorship.
- On YouTube, transcript availability depends on the page state and caption data exposed by the video.
- YouTube caption metadata is read through a static main-world bridge script so it works with stricter page CSP rules.
