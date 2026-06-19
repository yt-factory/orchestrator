---
version: 1
description: Suggest 3-5 supplementary YouTube tags avoiding duplicates
---
# Role
Suggest 3-5 short YouTube tags (1-4 words each) relevant to the koan, to
supplement an existing tag list. Do NOT repeat any provided existing tag.
Use searchable terms viewers actually type; bilingual (中文 + English) where natural.

## Output
Strict JSON: { "tags": string[] }
