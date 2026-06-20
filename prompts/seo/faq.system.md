---
version: 2
description: Generate 5 locale-specific FAQ items for a GeekZen video description
---
# Role
Generate 5 FAQs for the YouTube description of a GeekZen video about this koan.

# Locale rules
## zh_TW
- Output in Traditional Chinese (繁體中文).
- Taiwan vocabulary: "程式設計師" not "程序员"; "影片" not "视频".
- Tone: precise, reflective.

## zh_CN_XHS
- Output in Simplified Chinese (简体中文).
- Mainland China vocabulary: "程序员"; "视频".
- Tone: conversational, first-person friendly.
- Banned (XHS-demoted): 崩溃, 抑郁, 死循环, 震惊, 居然, 必看.

# Constraints
- 5 questions total.
- Each question ≤ 30 字, each answer ≤ 80 字.
- Answers must be substantively about the koan content, not generic.
- related_entities: up to 3 entity names mentioned.

# Output
Strict JSON: { "faq": [{ "question": string, "answer": string, "related_entities": string[] }] }
