const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { test, expect } = require("@playwright/test");

test.describe("ScriptLens shared surface helpers", () => {
  test("maps backend transcript reports to consumer inline copy", () => {
    const surface = loadSurfaceModule();
    const viewModel = surface.buildInlineReportViewModel(
      createReport({
        detection: {
          aiScore: 43,
          detectorConfidence: "medium",
          verdict: "Mixed / possibly assisted",
          reasons: ["Sentence rhythm stays unusually even across the sample."],
          explanation: "Sentence rhythm stays unusually even across the sample."
        },
        acquisition: {
          kind: "transcript",
          providerClass: "backend",
          strategy: "backend-transcript",
          sourceLabel: "Backend transcript fallback",
          sourceConfidence: "medium",
          acquisitionState: "partial-transcript",
          coverageRatio: 0.58,
          segmentCount: 37,
          transcriptSpanSeconds: 601,
          languageCode: "en"
        },
        inputQuality: {
          summary: "Transcript quality is limited but still useful."
        }
      })
    );

    expect(viewModel.sourceLabel).toBe("Recovered transcript");
    expect(viewModel.qualityLabel).toBe("Usable transcript");
    expect(viewModel.privacyDisclosure).toContain("video ID and requested language");
    expect(viewModel.confidenceLabel).toBe("Medium");
  });

  test("maps title and description fallback to consumer inline copy", () => {
    const surface = loadSurfaceModule();
    const viewModel = surface.buildInlineReportViewModel(
      createReport({
        acquisition: {
          kind: "transcript",
          providerClass: "local",
          strategy: "title-description",
          sourceLabel: "Title + description fallback",
          sourceConfidence: "low",
          acquisitionState: "fallback-text-only"
        }
      })
    );

    expect(viewModel.sourceLabel).toBe("Title and description");
    expect(viewModel.qualityLabel).toBe("Fallback text");
    expect(viewModel.privacyDisclosure).toBe("");
  });

  test("maps generated transcript reports to consumer inline copy", () => {
    const surface = loadSurfaceModule();
    const viewModel = surface.buildInlineReportViewModel(
      createReport({
        acquisition: {
          kind: "transcript",
          providerClass: "local",
          strategy: "caption-track",
          sourceLabel: "English auto captions",
          sourceConfidence: "high",
          acquisitionState: "transcript-acquired",
          isGenerated: true
        }
      })
    );

    expect(viewModel.sourceLabel).toBe("YouTube captions");
    expect(viewModel.qualityLabel).toBe("Strong transcript");
  });
});

function loadSurfaceModule() {
  const sourcePath = path.join(__dirname, "..", "surface", "shared.js");
  const code = fs.readFileSync(sourcePath, "utf8");
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: sourcePath });
  return context.globalThis.ScriptLensSurface;
}

function createReport(overrides = {}) {
  return {
    acquisition: {
      kind: "transcript",
      providerClass: "local",
      strategy: "caption-track",
      sourceLabel: "English captions",
      sourceConfidence: "high",
      acquisitionState: "transcript-acquired",
      coverageRatio: 0.91,
      segmentCount: 52,
      transcriptSpanSeconds: 744,
      languageCode: "en"
    },
    detection: {
      aiScore: 32,
      detectorConfidence: "medium",
      verdict: "Mixed / possibly assisted",
      reasons: ["The wording is smoother than typical unscripted speech."],
      explanation: "The wording is smoother than typical unscripted speech."
    },
    inputQuality: {
      summary: "The transcript coverage is strong enough for a stable read."
    },
    metadata: {
      sensitivity: "medium"
    },
    ...overrides
  };
}
