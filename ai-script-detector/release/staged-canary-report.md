# Staged Consumer QA Report

Generated: 2026-03-12T07:05:10.233Z
Backend: https://scriptlens-backend-134711094498.us-west2.run.app
Backend client instance: staging-backend-1773299110233-g7njl3
Inline: skipped

Backend transcript-class successes: 5/7
Inline success cards: skipped
Inline compact runs: skipped
Backend-good inline errors: skipped

| Video | Categories | Backend | Failure Category | Origin | Recovery | Trust | Winner | Latency (ms) | Inline | Compact | Workspace |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| Writing safety talk | hard-blocker, caption-recovery, medium | success | unknown | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 6254 | skipped | skipped | skipped |
| Advanced English transitions | hard-blocker, caption-recovery, medium | success | unknown | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 612 | skipped | skipped | skipped |
| Me at the zoo | short-video, caption-recovery | success | unknown | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 40 | skipped | skipped | skipped |
| YouTube API demo | clean-transcript, medium, developer | success | unknown | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 94 | skipped | skipped | skipped |
| Neural networks visual intro | clean-transcript, educational, medium | success | unknown | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 72 | skipped | skipped | skipped |
| Documentary over auto ASR cap | long-video, asr-duration-policy, documentary | fail (asr_duration_limit) | policy | unavailable | hosted_transcript | unavailable | asr_duration_limit | 32 | skipped | skipped | skipped |
| Very long podcast over absolute cap | long-video, asr-duration-policy, podcast | fail (asr_duration_absolute_limit) | policy | unavailable | hosted_transcript | unavailable | asr_duration_absolute_limit | 12694 | skipped | skipped | skipped |

## Notes

- `Inline` records whether the watch-page widget reached a success card, error card, or timed out.
- `Compact` requires the inline card to stay within the small watch-page footprint and avoid opening the YouTube transcript engagement panel.
- `Workspace` checks that `Open full workspace` stored a valid panel launch request.
