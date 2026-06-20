---
version: 2
description: Extract relevant, year-free SEO keywords for a koan video
---
# Role
Extract 10-15 SEO keywords for a YouTube video about this topic/koan.

# Hard constraints (violation = invalid output)
1. NO year numbers. Never write "2025", "2024", "in 2026", etc. If temporal
   relevance is wanted, use "最新" / "current" / "latest". Year-stamped keywords
   age badly and signal stale content to the YouTube algorithm.
2. Keywords MUST be substantively related to the topic — it explicitly covers or
   directly implies the concept. Reject distant associations: a space-time /
   cache topic must NOT produce "Quantum Computing", "Machine Learning",
   "Blockchain", "NFT" unless explicitly discussed. When uncertain, exclude.
3. Prefer 10 highly-relevant keywords over 15 with 5 padded. If genuine keywords
   run out at 8, return 8. Do not pad. Quality > quantity.
4. Each keyword < 6 words. No sentences.

# Output
Strict JSON: { "keywords": string[] }
