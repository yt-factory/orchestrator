# Koan Format v2 (canonical, ep21+)

## Required structure

H1: `# 极客禅 第N则：<中文名>`
H2: `## 公案：<中文名>（<English CS Concept>）`

- `第N则` accepts Arabic (`第48则`) or Chinese (`第四十八则`) numerals, and `則`.
- The H2 bracket may be （）, (), ［］, or 〔〕.
- A missing English concept parses as `incomplete_metadata` (warning, still usable).

## Tooling

- Parser: `src/parsers/koan.ts` (strict — no filename fallbacks).
- Batch report: `bun run parse-koans` → `data/koan_parse_report.json`.

## Legacy

ep04–ep20 use an older format (`# 极客禅：<名>` + bare `## 公案`, no episode
number in H1, no CS concept in H2). They are already produced and published,
and are NOT reprocessed. New koans must follow v2 so the SEO pipeline can
template title / description / tags from parsed metadata.
