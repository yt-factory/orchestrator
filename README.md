# YT-Factory Orchestrator

The brain of the YT-Factory pipeline — an automated YouTube content production system that orchestrates AI agents and multimedia tools to turn raw text/markdown into publish-ready video projects.

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                     YT-Factory Orchestrator                         │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   incoming/ files ──> FolderWatcher ──> WorkflowManager            │
│                              │                                      │
│                              ▼                                      │
│   ┌──────────────────────────────────────────────────────────┐     │
│   │              Request Flow Control                         │     │
│   │  Priority Queue ──> Token Bucket (60/min) ──> Gemini SDK │     │
│   │       │                    │                      │       │     │
│   │   [HIGH]              [MEDIUM]                 [LOW]      │     │
│   │   Script              SEO                      Shorts     │     │
│   └──────────────────────────────────────────────────────────┘     │
│                              │                                      │
│                              ▼                                      │
│   ┌──────────────────────────────────────────────────────────┐     │
│   │              Fallback Chain                               │     │
│   │  gemini-3-pro (3x) → gemini-3-flash (3x) → 2.5-flash (3x)│     │
│   │  + automatic prompt simplification on fallback            │     │
│   └──────────────────────────────────────────────────────────┘     │
│                              │                                      │
│                              ▼                                      │
│                     manifest.json per project                       │
│                              │                                      │
│                              ▼                                      │
│                      video-renderer → YouTube                       │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
cd orchestrator
bun install

# Create required directories
mkdir -p incoming active_projects data

# Run in mock mode (no API keys required)
MOCK_MODE=true bun run src/index.ts

# Run with real APIs
GEMINI_API_KEY=your_key bun run src/index.ts
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Bun |
| Language | TypeScript (strict) |
| Validation | Zod |
| File Watch | chokidar |
| AI SDK | @google/generative-ai |
| Protocol | MCP SDK |
| Connection Pool | generic-pool |
| Rate Limiting | Token Bucket + Priority Queue |

## Project Structure

```
orchestrator/
├── src/
│   ├── core/
│   │   ├── watcher.ts          # Directory monitoring (chokidar)
│   │   ├── workflow.ts         # State machine + heartbeat + stale recovery
│   │   └── manifest.ts         # Zod schema definitions
│   ├── agents/
│   │   ├── gemini-client.ts    # Gemini SDK (fallback chain + circuit breaker)
│   │   ├── seo-expert.ts       # Multi-language SEO with trend validation
│   │   ├── trends-hook.ts      # Google Trends authority scoring + decay
│   │   ├── shorts-extractor.ts # Emotional arc analysis + CTA injection
│   │   ├── voice-matcher.ts    # Voice persona recommendation
│   │   └── notebooklm-generator.ts # NotebookLM bilingual podcast scripts
│   ├── infra/
│   │   ├── circuit-breaker.ts  # Service resilience
│   │   ├── token-bucket.ts     # Rate limiting with jitter
│   │   └── priority-queue.ts   # Request priority management
│   ├── utils/
│   │   ├── logger.ts           # Structured JSON logging
│   │   ├── retry.ts            # Exponential backoff
│   │   └── cost-tracker.ts     # Token usage tracking
│   └── index.ts                # Entry point (strict startup ordering)
├── incoming/                   # Drop markdown files here
├── active_projects/            # Projects in progress
├── data/                       # Persistent data
│   ├── trends_authority.json   # Keyword authority tracking
│   └── cost_report.json        # Token usage reports
└── .env
```

## Usage Examples

### Example 1: Process a Single Article

```bash
# 1. Create a test article
cat > incoming/test-article.md << 'EOF'
# Why Rust is the Future of Systems Programming

Rust has been gaining significant traction in the systems programming world.
With its unique ownership model and zero-cost abstractions, it offers memory
safety without garbage collection.

## Key Features
- Memory safety without garbage collection
- Fearless concurrency
- Zero-cost abstractions
- Modern tooling with Cargo

## Industry Adoption
Companies like Microsoft, Google, and Amazon are increasingly adopting Rust
for critical infrastructure components.
EOF

# 2. Start the orchestrator (it will auto-detect the file)
MOCK_MODE=true bun run src/index.ts
```

**Expected Output:**
```json
{"timestamp":"2026-02-02T04:52:00.000Z","level":"info","projectId":"550e8400-...",
 "message":"File detected","path":"incoming/test-article.md","wordCount":89}
{"timestamp":"2026-02-02T04:52:01.000Z","level":"info","projectId":"550e8400-...",
 "message":"Project created","stage":"INIT"}
{"timestamp":"2026-02-02T04:52:02.000Z","level":"info","projectId":"550e8400-...",
 "message":"Script generation complete","segments":3}
{"timestamp":"2026-02-02T04:52:03.000Z","level":"info","projectId":"550e8400-...",
 "message":"SEO generation complete","tags":12,"regions":2}
{"timestamp":"2026-02-02T04:52:04.000Z","level":"info","projectId":"550e8400-...",
 "message":"Shorts extraction complete","hooks":2,"topEmotion":"curiosity"}
```

### Example 2: Batch Processing Multiple Articles

```bash
# Create multiple articles
for topic in "AI Code Review" "WebAssembly Performance" "GraphQL vs REST"; do
  echo "# $topic\n\nContent about $topic..." > "incoming/${topic// /-}.md"
done

# Start orchestrator (processes all files in parallel)
MOCK_MODE=true MAX_CONCURRENT_CONNECTIONS=5 bun run src/index.ts
```

### Example 3: Monitor Project Status

```bash
# Check all active projects
ls -la active_projects/

# View a specific project manifest
cat active_projects/550e8400-e29b-41d4-a716-446655440000/manifest.json | jq .

# Check project status
cat active_projects/*/manifest.json | jq '{id: .project_id, status: .status}'
```

### Example 4: Use NotebookLM Audio Workflow

```bash
# 1. Process an article (generates NotebookLM scripts)
echo "# Deep Learning Explained\n\nNeural networks..." > incoming/deep-learning.md
MOCK_MODE=true bun run src/index.ts

# 2. Find the generated scripts
PROJECT_ID=$(ls -t active_projects/ | head -1)
cat active_projects/$PROJECT_ID/notebooklm_script_en.md
cat active_projects/$PROJECT_ID/notebooklm_script_zh.md

# 3. Upload scripts to NotebookLM, generate audio, download to:
#    active_projects/$PROJECT_ID/audio/en.mp3
#    active_projects/$PROJECT_ID/audio/zh.mp3

# 4. The heartbeat will detect audio files and update manifest
```

### Example 5: Cost Tracking and Reporting

```bash
# View cumulative cost report
cat data/cost_report.json | jq .

# Expected output:
# {
#   "total_tokens_used": 45230,
#   "tokens_by_model": {
#     "gemini-3-pro": 38000,
#     "gemini-3-flash": 7230,
#     "gemini-2.5-flash": 0
#   },
#   "estimated_cost_usd": 0.194,
#   "api_calls_count": 12
# }
```

## Configuration

### Environment Variables

```bash
# .env file
# ===========================================
# MCP Gateway Configuration
# ===========================================
MCP_GATEWAY_COMMAND=uv run python -m src
MCP_GATEWAY_CWD=../mcp-gateway/mcp-gateway

# ===========================================
# API Keys
# ===========================================
GEMINI_API_KEY=your_gemini_api_key_here

# ===========================================
# Mock Mode (for development)
# ===========================================
MOCK_MODE=false

# ===========================================
# Logging
# ===========================================
LOG_LEVEL=info    # debug | info | warn | error

# ===========================================
# Directories
# ===========================================
INCOMING_DIR=./incoming
ACTIVE_PROJECTS_DIR=./active_projects
DATA_DIR=./data

# ===========================================
# Rate Limiting
# ===========================================
GEMINI_RATE_LIMIT_RPM=60
MAX_CONCURRENT_CONNECTIONS=5

# ===========================================
# Timeouts (milliseconds)
# ===========================================
GEMINI_API_TIMEOUT_MS=120000          # 2 minutes

# ===========================================
# Heartbeat & Recovery
# ===========================================
HEARTBEAT_INTERVAL_MS=60000           # 1 minute
STALE_THRESHOLD_ANALYZING_MS=600000   # 10 minutes
STALE_THRESHOLD_RENDERING_MS=1800000  # 30 minutes
STALE_THRESHOLD_UPLOADING_MS=300000   # 5 minutes
MAX_STALE_RECOVERY_COUNT=3
MAX_RETRIES=3
```

## Processing Pipeline (9 Stages)

| Stage | Name | Description |
|-------|------|-------------|
| 1 | INIT | Create project, transition to `analyzing` |
| 2 | SCRIPT_GENERATION | Generate video script segments with visual hints |
| 3 | TREND_ANALYSIS | Fetch and analyze trending keywords with authority |
| 4 | SEO_GENERATION | Multi-language SEO with forced trend coverage |
| 5 | SHORTS_EXTRACTION | Extract viral hooks with emotional triggers |
| 6 | VOICE_MATCHING | Match voice persona to content type |
| 7 | NOTEBOOKLM_GENERATION | Generate bilingual podcast scripts |
| 8 | MANIFEST_UPDATE | Persist all results to manifest.json |
| 9 | FINALIZATION | Transition to `pending_audio` or `rendering` |

## Key Features

### Multi-tier AI Fallback
```
gemini-3-pro (3x) → gemini-3-flash (3x) → gemini-2.5-flash (3x)
```
- Automatic retry with exponential backoff
- Prompt simplification on fallback models
- Circuit breaker for service protection

### Trend Authority Scoring
```
fleeting  → 1 consecutive window (< 6 hours)
emerging  → 2 consecutive windows (6-12 hours)
established → 3+ consecutive windows (12+ hours)
```
- 24-hour decay for stale keywords
- Forced trend coverage in titles

### Emotional Arc Analysis
```
anger     → High comment rate  → CTA: "你怎么看？"
awe       → High share rate    → CTA: "太神了吧！"
curiosity → High completion    → CTA: "想知道结果吗？"
fomo      → High click rate    → CTA: "别错过了！"
validation → High like rate    → CTA: "早该这样了"
```

### Stale Project Recovery
- Heartbeat monitors active projects every 60s
- Auto-recovery for stuck projects
- Dead letter queue for repeated failures

## Manifest Schema

The manifest.json is the contract between orchestrator and video-renderer:

```typescript
{
  project_id: string,           // UUID
  status: 'pending' | 'analyzing' | 'pending_audio' | 'rendering' | 'uploading' | 'completed' | 'failed',

  input_source: {
    local_path: string,
    raw_content: string,
    word_count: number
  },

  content_engine: {
    script: [{
      timestamp: "00:00",
      voiceover: "...",
      visual_hint: "code_block" | "diagram" | "text_animation" | ...
    }],

    seo: {
      tags: string[],
      chapters: string,
      regional_seo: [{ language, titles, description }],
      trend_coverage_score: number
    },

    shorts: {
      hooks: [{
        text: string,
        timestamp_start: string,
        timestamp_end: string,
        emotional_trigger: "anger" | "awe" | "curiosity" | "fomo" | "validation",
        injected_cta: string
      }]
    },

    media_preference: {
      visual: { mood, content_type, theme_suggestion },
      voice: { provider, voice_id, style }
    }
  },

  audio: {
    source: "notebooklm",
    languages: {
      en: { audio_status: "pending" | "ready", duration_seconds: number },
      zh: { audio_status: "pending" | "ready", duration_seconds: number }
    }
  },

  meta: {
    model_used: string,
    is_fallback_mode: boolean,
    cost: { total_tokens_used, estimated_cost_usd }
  }
}
```

## Troubleshooting

### "Connection refused" to MCP Gateway
```bash
# Check if gateway is running
cd ../mcp-gateway/mcp-gateway
MOCK_MODE=true uv run python -m src
```

### "Rate limit exceeded"
```bash
# Check token bucket status
cat data/cost_report.json | jq .api_calls_count

# Reduce concurrency
MAX_CONCURRENT_CONNECTIONS=2 bun run src/index.ts
```

### "Project stuck in analyzing"
```bash
# Check heartbeat logs
grep "stale" logs/*.log

# Manual recovery
cat active_projects/PROJECT_ID/manifest.json | jq '.status = "pending"' > /tmp/m.json
mv /tmp/m.json active_projects/PROJECT_ID/manifest.json
```

### "TypeScript compilation errors"
```bash
# Verify types
bun run tsc --noEmit

# Check for strict mode issues
# See CLAUDE.md "Gotchas" section for common patterns
```

## Integration

The orchestrator integrates with:

1. **MCP Gateway** - External API access (YouTube, Trends)
2. **Video Renderer** - Video production from manifest.json
3. **NotebookLM** - High-quality AI podcast audio (manual step)

```
orchestrator → manifest.json → video-renderer → YouTube
     ↓
  mcp-gateway → Google APIs
```

## Recent Updates (Feb 2026)

- **Circuit Breaker**: Added service resilience pattern
- **Bounded Queue**: Priority-based backpressure for API calls
- **Token Bucket Jitter**: Prevents thundering herd on rate limits
- **API Timeout**: 2-minute timeout with Promise.race()
- **Race Condition Fix**: Promise-based locking in FileHashManager

---

*Part of the [YT-Factory](../docs/SETUP.md) YouTube automation ecosystem*
