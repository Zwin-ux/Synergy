const { test, expect } = require("./fixtures");

test.describe("ScriptLens popup rendering contracts", () => {
  test("renders a transcript-unavailable report without throwing", async ({
    context,
    extensionId
  }) => {
    const popupPage = await context.newPage();
    await popupPage.addInitScript(() => {
      globalThis.chrome = globalThis.chrome || {};
      globalThis.chrome.runtime = globalThis.chrome.runtime || {};
      const initResponse = {
        ok: true,
        settings: {
          sensitivity: "medium",
          maxTextLength: 18000,
          debugMode: false,
          allowBackendTranscriptFallback: true
        },
        recentReports: [],
        pageContext: {
          supported: true,
          title: "Sample fallback page",
          hostname: "youtube.com",
          selectionAvailable: false,
          pageAvailable: false,
          isYouTubeVideo: true,
          transcriptAvailable: false,
          recommendedRequest: {
            mode: "youtube",
            includeSources: ["description", "title"],
            trackBaseUrl: ""
          },
          video: {
            availableSources: {
              transcript: false,
              description: true,
              title: true
            },
            transcriptTracks: []
          }
        }
      };
      const analyzeResponse = {
        ok: false,
        error: "Enhanced extraction unavailable.",
        acquisition: {
          kind: "transcript",
          sourceLabel: "Unavailable",
          providerClass: "local",
          sourceConfidence: "low",
          quality: "enhanced-extraction-unavailable",
          acquisitionState: "transcript-unavailable",
          transcriptRequiredSatisfied: false,
          failureReason: "transcript_required",
          warnings: ["enhanced_extraction_unavailable"],
          resolverPath: [],
          winnerSelectedBy: [],
          errors: []
        }
      };

      Object.defineProperty(chrome.runtime, "sendMessage", {
        configurable: true,
        value(message) {
          if (message?.type === "popup:init") {
            return Promise.resolve(initResponse);
          }
          if (message?.type === "popup:analyze") {
            return Promise.resolve(analyzeResponse);
          }
          return Promise.resolve({
            ok: false,
            error: "Unexpected message in popup render test."
          });
        }
      });
    });

    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: "domcontentloaded"
    });

    await popupPage.locator("#recommendedActionButton").click();

    await expect(popupPage.locator("#resultContent")).toBeVisible({ timeout: 15000 });
    await expect(popupPage.locator("#reportExplanation")).toContainText(
      "Enhanced extraction unavailable."
    );
    await expect(popupPage.locator("#acquisitionQualityBadge")).toContainText(
      "Transcript unavailable"
    );
    await expect(popupPage.locator("#trustNotMeans")).toContainText(
      "not proof of authorship"
    );
    await expect(popupPage.locator("#statusBanner")).toContainText(
      "Enhanced extraction unavailable."
    );
  });

  test("renders backend partial transcript labeling and privacy disclosure", async ({
    context,
    extensionId
  }) => {
    const popupPage = await context.newPage();
    await popupPage.addInitScript(() => {
      globalThis.chrome = globalThis.chrome || {};
      globalThis.chrome.runtime = globalThis.chrome.runtime || {};
      const initResponse = {
        ok: true,
        settings: {
          sensitivity: "medium",
          maxTextLength: 18000,
          debugMode: false,
          allowBackendTranscriptFallback: true
        },
        recentReports: [],
        pageContext: {
          supported: true,
          title: "Sample backend transcript page",
          hostname: "youtube.com",
          selectionAvailable: false,
          pageAvailable: false,
          isYouTubeVideo: true,
          transcriptAvailable: true,
          recommendedRequest: {
            mode: "youtube",
            includeSources: ["transcript"],
            trackBaseUrl: "",
            requireTranscript: true,
            allowFallbackText: false
          },
          video: {
            availableSources: {
              transcript: true,
              description: true,
              title: true
            },
            transcriptTracks: []
          }
        }
      };
      const analyzeResponse = {
        ok: true,
        report: {
          source: "YouTube video - Sample backend transcript page - Backend transcript fallback",
          score: 38,
          verdict: "Unlikely AI-written",
          explanation:
            "The transcript sample reads more like a spoken performance than a templated script.",
          disclaimer: "This score reflects AI-like writing patterns, not proof of authorship.",
          detection: {
            aiScore: 38,
            detectorConfidence: "medium",
            verdict: "Unlikely AI-written",
            reasons: ["Natural pauses and irregular spoken phrasing reduce script-like signals."],
            categoryScores: {
              repetition: 18,
              uniformity: 24
            },
            triggeredPatterns: [],
            flaggedSentences: [],
            explanation:
              "The transcript sample reads more like a spoken performance than a templated script."
          },
          acquisition: {
            kind: "transcript",
            provider: "backendResolver",
            providerClass: "backend",
            strategy: "backend-transcript",
            sourceLabel: "Backend transcript fallback",
            sourceConfidence: "high",
            quality: "partial-transcript",
            acquisitionState: "partial-transcript",
            transcriptRequiredSatisfied: true,
            failureReason: null,
            languageCode: "en",
            originalLanguageCode: "en",
            transcriptSpanSeconds: 98,
            coverageRatio: 0.41,
            segmentCount: 12,
            warnings: ["backend_fallback_used"],
            errors: [],
            resolverAttempts: [],
            resolverPath: ["backendResolver:backend-transcript"],
            winnerSelectedBy: ["backend-success"],
            text: "A backend transcript sample."
          },
          inputQuality: {
            label: "Partial input",
            summary: "The transcript is real, but coverage is still limited.",
            reasons: []
          },
          interpretation: {
            means: "This score reflects the available transcript slice only.",
            notMeans: "This is not proof of authorship.",
            falsePositives: [],
            trustMore: ["Prefer fuller transcripts when possible."]
          },
          metadata: {
            wordCount: 240,
            sentenceCount: 14,
            sensitivity: "medium"
          },
          topReasons: ["Natural pauses and irregular spoken phrasing reduce script-like signals."],
          categoryScores: {
            repetition: 18,
            uniformity: 24
          },
          flaggedSentences: []
        },
        settings: initResponse.settings,
        recentReports: [],
        pageContext: initResponse.pageContext,
        uiHints: {}
      };

      Object.defineProperty(chrome.runtime, "sendMessage", {
        configurable: true,
        value(message) {
          if (message?.type === "popup:init") {
            return Promise.resolve(initResponse);
          }
          if (message?.type === "popup:analyze") {
            return Promise.resolve(analyzeResponse);
          }
          return Promise.resolve({
            ok: false,
            error: "Unexpected message in popup render test."
          });
        }
      });
    });

    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: "domcontentloaded"
    });

    await popupPage.locator("#recommendedActionButton").click();

    await expect(popupPage.locator("#resultContent")).toBeVisible({ timeout: 15000 });
    await expect(popupPage.locator("#acquisitionQualityBadge")).toContainText(
      "Partial transcript"
    );
    await expect(popupPage.locator("#providerBadge")).toContainText("Recovered transcript");
    await expect(popupPage.locator("#privacyDisclosure")).toContainText(
      "video ID and requested language"
    );
    await expect(popupPage.locator("#acquisitionStateCopy")).toContainText(
      "real transcript source"
    );
  });
});
