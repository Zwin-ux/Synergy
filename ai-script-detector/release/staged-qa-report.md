# Staged Consumer QA Report

Generated: 2026-03-12T04:31:16.758Z
Backend: https://scriptlens-backend-134711094498.us-west2.run.app
Backend client instance: staging-backend-1773289876758-7a63w3
Inline client instance: staging-inline-1773289876758-7a63w3

Backend transcript-class successes: 11/18
Inline success cards: 11/18
Inline compact runs: 18/18

| Video | Categories | Backend | Origin | Recovery | Trust | Winner | Latency (ms) | Inline | Compact | Workspace |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| Writing safety talk | hard-blocker, caption-recovery, medium | success | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 1243 | success | yes | yes |
| Advanced English transitions | hard-blocker, caption-recovery, medium | success | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 6212 | success | yes | yes |
| Me at the zoo | short-video, caption-recovery | success | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 104 | success | yes | yes |
| YouTube API demo | clean-transcript, medium, developer | success | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 297 | success | yes | yes |
| Neural networks visual intro | clean-transcript, educational, medium | success | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 87 | success | yes | yes |
| Try something new for 30 days | clean-transcript, talk, medium | success | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 39 | success | yes | yes |
| Google keynote session | long-video, clean-transcript, conference | success | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 117 | success | yes | yes |
| 35 minute lecture | near-asr-cap, lecture, clean-transcript | success | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 38 | success | yes | yes |
| Long lecture success case | long-video, clean-transcript, lecture | success | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 68 | success | yes | yes |
| Spanish talk candidate | non-english, translated-captions-candidate, caption-recovery | success | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 35 | success | yes | yes |
| Spanish talk candidate two | non-english, translated-captions-candidate, caption-recovery | success | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 37 | success | yes | yes |
| Big Buck Bunny trailer | transcript-miss, asr-fallback-candidate | fail (backend_timeout) | unavailable | hosted_transcript | unavailable | backend_timeout | 39528 | error | yes | yes |
| Gangnam Style | non-english, translated-captions-candidate, asr-fallback-candidate | fail (asr_audio_browser_session_media_missing) | unavailable | hosted_transcript | unavailable | asr_audio_browser_session_media_missing | 40298 | error | yes | yes |
| Despacito | non-english, translated-captions-candidate, asr-fallback-candidate | fail (asr_audio_browser_session_media_missing) | unavailable | hosted_transcript | unavailable | asr_audio_browser_session_media_missing | 43651 | error | yes | yes |
| Documentary over auto ASR cap | long-video, asr-duration-policy, documentary | fail (asr_duration_limit) | unavailable | hosted_transcript | unavailable | asr_duration_limit | 19364 | error | yes | yes |
| Very long podcast over absolute cap | long-video, asr-duration-policy, podcast | fail (asr_duration_absolute_limit) | unavailable | hosted_transcript | unavailable | asr_duration_absolute_limit | 16321 | error | yes | yes |
| Rick Astley quality reject | generated-captions-candidate, quality-gate, music | fail (sentence_structure_below_threshold) | unavailable | hosted_transcript | unavailable | sentence_structure_below_threshold | 28959 | error | yes | yes |
| Japan vlog degraded captions | generated-captions-candidate, quality-gate, non-english | fail (non_letter_noise) | unavailable | hosted_transcript | unavailable | non_letter_noise | 28367 | error | yes | yes |

## Notes

- `Inline` records whether the watch-page widget reached a success card, error card, or timed out.
- `Compact` requires the inline card to stay within the small watch-page footprint and avoid opening the YouTube transcript engagement panel.
- `Workspace` checks that `Open full workspace` stored a valid panel launch request.
