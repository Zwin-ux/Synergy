# Optional Backend Helper

The Chrome Web Store package for ScriptLens does not include the local backend helper. The helper is an advanced optional companion for users who need stronger transcript recovery on videos where the page does not expose transcript text reliably.

## What the helper is for

- Recover transcript text when YouTube exposes metadata but not enough transcript content on the page
- Use `yt-dlp` when configured
- Provide a local-only HTTP endpoint for the extension at `http://127.0.0.1:4317/transcript/resolve`

## What the helper receives

When the extension uses the helper, it sends only:

- the YouTube video ID
- the requested language, if one is selected

The helper is still optional. ScriptLens works without it.

## Windows setup

1. Install `yt-dlp` for your user profile:
   - `python -m pip install --user yt-dlp`
2. Set the persistent helper path for future terminals:
   - `[Environment]::SetEnvironmentVariable("SCRIPTLENS_YTDLP_COMMAND", "$env:APPDATA\\Python\\Python311\\Scripts\\yt-dlp.exe", "User")`
3. Open a new terminal and start the helper:
   - `npm.cmd run backend:start`

If you prefer Python module execution instead of a direct executable, use `SCRIPTLENS_YTDLP_PYTHONPATH` and optionally `SCRIPTLENS_YTDLP_PYTHON`.

## Release note

Keep this helper documentation outside the Chrome Web Store upload zip. The helper is a separate advanced setup path, not part of the extension runtime package.
