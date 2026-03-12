const path = require("path");
const { test, expect } = require("@playwright/test");

const Contracts = require(path.join(__dirname, "..", "shared", "contracts.js"));

test.describe("ScriptLens shared contracts", () => {
  test("exports the frozen release contract fields", () => {
    expect(Contracts.CONTRACT_VERSION).toBe("2026-03-11");
    expect(Contracts.ORIGIN_KINDS.audioAsr).toBe("audio_asr");
    expect(Contracts.RECOVERY_TIERS.hostedTranscript).toBe("hosted_transcript");
    expect(Contracts.SOURCE_TRUST_TIERS.audioDerived).toBe("audio-derived");
    expect(Contracts.RUNTIME_MESSAGE_TYPES.inlineAnalyze).toBe("inline:analyze");
    expect(Contracts.PACKAGING_ENV_KEYS.publicSiteOrigin).toBe(
      "SCRIPTLENS_PUBLIC_SITE_ORIGIN"
    );
  });

  test("categorizes failure codes through the shared taxonomy", () => {
    expect(Contracts.categorizeFailureCode("asr_duration_limit")).toBe("policy");
    expect(Contracts.categorizeFailureCode("quality_gate_rejected")).toBe("quality");
    expect(Contracts.categorizeFailureCode("backend_timeout")).toBe("timeout");
    expect(Contracts.categorizeFailureCode("transport_error")).toBe("transport");
    expect(Contracts.categorizeFailureCode("asr_audio_browser_session_bot_gate")).toBe(
      "auth-session"
    );
    expect(Contracts.categorizeFailureCode("caption_tracks_missing")).toBe(
      "transcript-source"
    );
  });

  test("builds stable report snapshots for drift tests", () => {
    const snapshot = Contracts.buildAnalysisContractSnapshot({
      contractVersion: Contracts.CONTRACT_VERSION,
      analysisMode: "youtube-transcript-first",
      scoringStatus: "insufficient-input",
      acquisition: {
        originKind: "manual_caption_track",
        recoveryTier: "hosted_transcript",
        sourceTrustTier: "caption-derived",
        winnerReason: "quality-eligible:manual_caption_track",
        qualityGate: {
          eligible: true
        }
      }
    });

    expect(snapshot).toEqual({
      contractVersion: "2026-03-11",
      analysisMode: "youtube-transcript-first",
      scoringStatus: "insufficient-input",
      failureCategory: null,
      originKind: "manual_caption_track",
      recoveryTier: "hosted_transcript",
      sourceTrustTier: "caption-derived",
      winnerReason: "quality-eligible:manual_caption_track",
      qualityGate: {
        eligible: true
      }
    });
  });
});
