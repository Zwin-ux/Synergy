const { test, expect } = require("@playwright/test");
const { resolveTranscriptRequest } = require("../backend/resolve");

test.describe("ScriptLens backend transcript resolver", () => {
  test("returns a normalized caption-track transcript contract", async () => {
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

    const fetchImpl = async (url) => {
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
                  utf8: `Caption segment ${index + 1} carries enough spoken detail to behave like a usable transcript sample.`
                }
              ]
            }))
          })
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await resolveTranscriptRequest(
      {
        url: "https://www.youtube.com/watch?v=abc123xyz78",
        requestedLanguageCode: "en",
        includeTimestamps: true
      },
      { fetchImpl }
    );

    expect(result.ok).toBeTruthy();
    expect(result.providerClass).toBe("backend");
    expect(result.sourceLabel).toContain("caption");
    expect(result.sourceConfidence).toBe("high");
    expect(result.quality).toBe("strong-transcript");
    expect(result.transcriptSpanSeconds).toBeGreaterThan(120);
    expect(result.videoDurationSeconds).toBe(360);
    expect(result.coverageRatio).toBeGreaterThan(0.45);
    expect(result.warnings).toContain("backend_static_caption_track");
    expect(Array.isArray(result.segments)).toBeTruthy();
    expect(result.segments.length).toBeGreaterThanOrEqual(18);
    expect(typeof result.text).toBe("string");
  });

  test("falls back to a headless transcript result when static extraction misses", async () => {
    const html = buildWatchHtml({
      playerResponse: {
        videoDetails: {
          lengthSeconds: "240"
        }
      }
    });

    const fetchImpl = async (url) => {
      if (/youtube\.com\/watch/.test(String(url))) {
        return makeTextResponse(html);
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await resolveTranscriptRequest(
      {
        url: "https://www.youtube.com/watch?v=def456uvw90",
        requestedLanguageCode: "en"
      },
      {
        fetchImpl,
        headlessResolver: async () => ({
          ok: true,
          text: Array.from({ length: 12 }, (_, index) => {
            return `Headless segment ${index + 1} adds enough detail to form a reliable backend transcript fallback.`;
          }).join("\n"),
          segments: Array.from({ length: 12 }, (_, index) => ({
            startMs: index * 15000,
            durationMs: 12000,
            text: `Headless segment ${index + 1} adds enough detail to form a reliable backend transcript fallback.`
          })),
          languageCode: "en",
          originalLanguageCode: "en",
          sourceConfidence: "medium",
          videoDurationSeconds: 240,
          warnings: ["backend_headless_test"]
        })
      }
    );

    expect(result.ok).toBeTruthy();
    expect(result.providerClass).toBe("backend");
    expect(result.sourceLabel).toBe("Headless transcript panel");
    expect(result.sourceConfidence).toBe("medium");
    expect(result.quality).toBe("partial-transcript");
    expect(result.transcriptSpanSeconds).toBeGreaterThan(100);
    expect(result.videoDurationSeconds).toBe(240);
    expect(result.warnings).toContain("backend_headless_fallback");
    expect(result.warnings).toContain("backend_headless_test");
  });

  test("uses yt-dlp fallback when static and youtubei paths miss", async () => {
    const html = buildWatchHtml({
      playerResponse: {
        videoDetails: {
          lengthSeconds: "879"
        },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                baseUrl: "https://captions.example/blocked",
                languageCode: "en",
                kind: "asr",
                name: { simpleText: "English" }
              }
            ]
          }
        }
      }
    });

    const fetchImpl = async (url) => {
      if (/youtube\.com\/watch/.test(String(url))) {
        return makeTextResponse(html);
      }
      if (String(url).startsWith("https://captions.example/blocked")) {
        return makeTextResponse("");
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await resolveTranscriptRequest(
      {
        url: "https://www.youtube.com/watch?v=RtuXNUlUX7Q",
        requestedLanguageCode: "en",
        includeTimestamps: true
      },
      {
        fetchImpl,
        ytDlpResolver: async () => ({
          ok: true,
          text: Array.from({ length: 16 }, (_, index) => {
            return `yt-dlp segment ${index + 1} carries enough spoken detail to satisfy transcript-first analysis on a blocked YouTube caption path.`;
          }).join("\n"),
          segments: Array.from({ length: 16 }, (_, index) => ({
            startMs: index * 55000,
            durationMs: 50000,
            text: `yt-dlp segment ${index + 1} carries enough spoken detail to satisfy transcript-first analysis on a blocked YouTube caption path.`
          })),
          sourceConfidence: "high",
          languageCode: "en",
          originalLanguageCode: "en",
          warnings: ["backend_yt_dlp_test"]
        }),
        headlessResolver: async () => ({
          ok: false,
          errorCode: "backend_headless_failed",
          errorMessage: "Should not be needed after yt-dlp success."
        })
      }
    );

    expect(result.ok).toBeTruthy();
    expect(result.providerClass).toBe("backend");
    expect(result.sourceLabel).toBe("Backend yt-dlp transcript");
    expect(result.sourceConfidence).toBe("high");
    expect(result.quality).toBe("partial-transcript");
    expect(result.coverageRatio).toBeGreaterThan(0.45);
    expect(result.transcriptSpanSeconds).toBeGreaterThan(120);
    expect(result.videoDurationSeconds).toBe(879);
    expect(result.warnings).toContain("backend_yt_dlp_fallback");
    expect(result.warnings).toContain("backend_yt_dlp_test");
  });

  test("surfaces backend timeout failure codes explicitly", async () => {
    const html = buildWatchHtml({
      playerResponse: {
        videoDetails: {
          lengthSeconds: "180"
        }
      }
    });

    const fetchImpl = async (url) => {
      if (/youtube\.com\/watch/.test(String(url))) {
        return makeTextResponse(html);
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await resolveTranscriptRequest(
      {
        url: "https://www.youtube.com/watch?v=ghi789rst12"
      },
      {
        fetchImpl,
        totalTimeoutMs: 1500,
        headlessStageTimeoutMs: 200,
        headlessResolver: ({ signal }) =>
          new Promise((resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new Error("timeout")),
              { once: true }
            );
          })
      }
    );

    expect(result.ok).toBeFalsy();
    expect(result.errorCode).toBe("backend_timeout");
    expect(result.warnings).toContain("backend_timeout");
    expect(result.quality).toBe("enhanced-extraction-unavailable");
    expect(result).toHaveProperty("sourceConfidence");
    expect(result).toHaveProperty("transcriptSpanSeconds");
    expect(result).toHaveProperty("videoDurationSeconds");
    expect(result).toHaveProperty("warnings");
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
