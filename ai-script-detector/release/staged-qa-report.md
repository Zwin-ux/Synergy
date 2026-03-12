# Staged Consumer QA Report

Generated: 2026-03-12T06:55:31.562Z
Backend: https://scriptlens-backend-134711094498.us-west2.run.app
Backend client instance: staging-backend-1773298531562-3ibvox
Inline client instance: staging-inline-1773298531562-3ibvox

Backend transcript-class successes: 11/18
Inline success cards: 11/18
Inline compact runs: 16/18
Backend-good inline errors: 0

| Video | Categories | Backend | Failure Category | Origin | Recovery | Trust | Winner | Latency (ms) | Inline | Compact | Workspace |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| Writing safety talk | hard-blocker, caption-recovery, medium | success | unknown | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 7576 | success | yes | yes |
| Advanced English transitions | hard-blocker, caption-recovery, medium | success | unknown | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 6436 | success | yes | yes |
| Me at the zoo | short-video, caption-recovery | success | unknown | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 5661 | success | yes | yes |
| YouTube API demo | clean-transcript, medium, developer | success | unknown | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 5822 | success | yes | yes |
| Neural networks visual intro | clean-transcript, educational, medium | success | unknown | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 10709 | success | yes | yes |
| Try something new for 30 days | clean-transcript, talk, medium | success | unknown | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 15481 | success | yes | yes |
| Google keynote session | long-video, clean-transcript, conference | success | unknown | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 7614 | success | yes | yes |
| 35 minute lecture | near-asr-cap, lecture, clean-transcript | success | unknown | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 5918 | success | yes | yes |
| Long lecture success case | long-video, clean-transcript, lecture | success | unknown | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 6237 | success | yes | yes |
| Spanish talk candidate | non-english, translated-captions-candidate, caption-recovery | success | unknown | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 8076 | success | yes | yes |
| Spanish talk candidate two | non-english, translated-captions-candidate, caption-recovery | success | unknown | manual_caption_track | hosted_transcript | caption-derived | quality-eligible:manual_caption_track | 6379 | success | yes | yes |
| Big Buck Bunny trailer | transcript-miss, asr-fallback-candidate | fail (asr_audio_browser_session_media_missing) | transcript-source | unavailable | hosted_transcript | unavailable | asr_audio_browser_session_media_missing | 37045 | error | yes | yes |
| Gangnam Style | non-english, translated-captions-candidate, asr-fallback-candidate | fail (asr_audio_browser_session_media_missing) | transcript-source | unavailable | hosted_transcript | unavailable | asr_audio_browser_session_media_missing | 39403 | error | yes | yes |
| Despacito | non-english, translated-captions-candidate, asr-fallback-candidate | fail (asr_audio_browser_session_media_missing) | transcript-source | unavailable | hosted_transcript | unavailable | asr_audio_browser_session_media_missing | 40548 | error | yes | yes |
| Documentary over auto ASR cap | long-video, asr-duration-policy, documentary | fail (asr_duration_limit) | policy | unavailable | hosted_transcript | unavailable | asr_duration_limit | 18564 | error | yes | yes |
| Very long podcast over absolute cap | long-video, asr-duration-policy, podcast | fail (asr_duration_absolute_limit) | policy | unavailable | hosted_transcript | unavailable | asr_duration_absolute_limit | 17146 | error | yes | yes |
| Rick Astley quality reject | generated-captions-candidate, quality-gate, music | fail (sentence_structure_below_threshold) | unknown | unavailable | hosted_transcript | unavailable | sentence_structure_below_threshold | 30164 | crashed (unclear) | no | no |
| Japan vlog degraded captions | generated-captions-candidate, quality-gate, non-english | fail (non_letter_noise) | quality | unavailable | hosted_transcript | unavailable | non_letter_noise | 28421 | crashed (unclear) | no | no |

## Notes

- `Inline` records whether the watch-page widget reached a success card, error card, or timed out.
- `Compact` requires the inline card to stay within the small watch-page footprint and avoid opening the YouTube transcript engagement panel.
- `Workspace` checks that `Open full workspace` stored a valid panel launch request.
