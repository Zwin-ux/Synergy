const { test, expect } = require("@playwright/test");
const { createBackendServer } = require("../backend/server");

test.describe("ScriptLens backend HTTP server", () => {
  test("serves transcript requests without aborting normal clients", async () => {
    const html = buildWatchHtml({
      playerResponse: {
        videoDetails: {
          lengthSeconds: "360"
        },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                baseUrl: "https://captions.example/manual",
                languageCode: "en",
                kind: "",
                name: { simpleText: "English" }
              }
            ]
          }
        }
      }
    });

    const server = createBackendServer({
      fetchImpl: async (url) => {
        if (/youtube\.com\/watch/.test(String(url))) {
          return makeTextResponse(html);
        }
        if (String(url).startsWith("https://captions.example/manual")) {
          return makeTextResponse(
            JSON.stringify({
              events: Array.from({ length: 20 }, (_, index) => ({
                tStartMs: index * 18000,
                dDurationMs: 17000,
                segs: [
                  {
                    utf8: `Caption segment ${index + 1} keeps the HTTP server on a transcript-class source.`
                  }
                ]
              }))
            })
          );
        }
        throw new Error(`Unexpected URL: ${url}`);
      }
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/transcript/resolve`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          url: "https://www.youtube.com/watch?v=abc123xyz78",
          requestedLanguageCode: "en",
          includeTimestamps: true
        })
      });
      const payload = await response.json();

      expect(response.ok).toBeTruthy();
      expect(payload.ok).toBeTruthy();
      expect(payload.errorCode).toBeUndefined();
      expect(payload.providerClass).toBe("backend");
      expect(payload.sourceLabel).toContain("caption");
      expect(payload.warnings).toContain("backend_static_caption_track");
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});

function buildWatchHtml({ playerResponse = {}, initialData = {}, ytcfg = {} }) {
  return `<!doctype html>
  <html lang="en">
    <head><meta charset="utf-8"><title>ScriptLens test video</title></head>
    <body>
      <script>var ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};</script>
      <script>var ytInitialData = ${JSON.stringify(initialData)};</script>
      <script>ytcfg.set(${JSON.stringify(ytcfg)});</script>
    </body>
  </html>`;
}

function makeTextResponse(text) {
  return {
    ok: true,
    status: 200,
    text: async () => text
  };
}
