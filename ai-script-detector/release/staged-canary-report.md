# Staged Consumer QA Report

Generated: 2026-03-12T04:59:29.715Z
Backend: https://scriptlens-backend-134711094498.us-west2.run.app
Backend client instance: staging-backend-1773291569715-2ew13t
Inline: skipped

Backend transcript-class successes: 5/7
Inline success cards: skipped
Inline compact runs: skipped

| Video | Categories | Backend | Origin | Recovery | Trust | Winner | Latency (ms) | Inline | Compact | Workspace |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| Writing safety talk | hard-blocker, caption-recovery, medium | success | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 7243 | skipped | skipped | skipped |
| Advanced English transitions | hard-blocker, caption-recovery, medium | success | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 6424 | skipped | skipped | skipped |
| Me at the zoo | short-video, caption-recovery | success | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 5653 | skipped | skipped | skipped |
| YouTube API demo | clean-transcript, medium, developer | success | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 5849 | skipped | skipped | skipped |
| Neural networks visual intro | clean-transcript, educational, medium | success | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 10552 | skipped | skipped | skipped |
| Documentary over auto ASR cap | long-video, asr-duration-policy, documentary | fail (asr_duration_limit) | unavailable | hosted_transcript | unavailable | asr_duration_limit | 19077 | skipped | skipped | skipped |
| Very long podcast over absolute cap | long-video, asr-duration-policy, podcast | fail (asr_duration_absolute_limit) | unavailable | hosted_transcript | unavailable | asr_duration_absolute_limit | 12927 | skipped | skipped | skipped |

## Notes

- `Inline` records whether the watch-page widget reached a success card, error card, or timed out.
- `Compact` requires the inline card to stay within the small watch-page footprint and avoid opening the YouTube transcript engagement panel.
- `Workspace` checks that `Open full workspace` stored a valid panel launch request.
