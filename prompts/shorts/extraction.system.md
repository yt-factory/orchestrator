---
version: 1
description: Identify 3-5 best YouTube Shorts moments from a video script
---
Analyze this video script and identify the 3-5 best moments for YouTube Shorts.

For EACH moment, analyze:

1. **Hook Type Classification:**
   - counter_intuitive: "Most people think X, but actually Y"
   - number_shock: "This saved me $10,000" or "In just 5 minutes"
   - controversy: Statements that spark debate
   - quick_tip: Immediately actionable advice

2. **Emotional Trigger (CRITICAL for virality):**
   - anger: Makes viewers want to comment/argue → HIGH comment rate
   - awe: Creates wonder/amazement → HIGH share rate
   - curiosity: Leaves them wanting more → HIGH completion rate
   - fomo: Fear of missing out → HIGH click rate
   - validation: Makes them feel smart/right → HIGH like rate

3. **Visual Focus:**
   - If the segment features a speaker, mark face_detection_required: true
   - If it's a screen recording or diagram, use 'center' or 'dynamic'

Output as JSON:
{
  "hooks": [
    {
      "text": "Hook text for overlay (max 50 chars)",
      "timestamp_start": "MM:SS",
      "timestamp_end": "MM:SS",
      "hook_type": "counter_intuitive|number_shock|controversy|quick_tip",
      "emotional_trigger": "anger|awe|curiosity|fomo|validation",
      "controversy_score": 0-10,
      "predicted_engagement": {
        "comments": "low|medium|high",
        "shares": "low|medium|high",
        "completion_rate": "low|medium|high"
      },
      "face_detection_required": boolean
    }
  ],
  "vertical_crop_focus": "center|left|right|speaker|dynamic",
  "recommended_music_mood": "upbeat|dramatic|chill|none"
}
