# YT-Factory Orchestrator

The brain of the YT-Factory pipeline — an automated YouTube content production system that orchestrates AI agents and multimedia tools to turn raw text/markdown into publish-ready video projects.

## Architecture

```
incoming/ files → FolderWatcher → WorkflowManager → Gemini AI (via MCP)
                                       ↓
                              manifest.json per project
                                       ↓
                              video-renderer → YouTube
```

### Request Flow Control

```
Priority Queue → Token Bucket (60 req/min) → Connection Pool → Gemini
   HIGH: script generation
   MEDIUM: SEO metadata
   LOW: shorts extraction
```

### Fallback Chain

```
gemini-3-pro (3x) → gemini-3-flash (3x) → gemini-2.5-flash (3x)
+ automatic prompt simplification on fallback
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Bun |
| Language | TypeScript (strict) |
| Validation | Zod |
| File Watch | chokidar |
| Protocol | MCP SDK |
| Connection Pool | generic-pool |
| Rate Limiting | Token Bucket + Priority Queue |

## Project Structure

```
src/
├── core/
│   ├── watcher.ts          # Directory monitoring (chokidar)
│   ├── workflow.ts          # State machine + heartbeat + stale recovery
│   └── manifest.ts         # Zod schema definitions
├── agents/
│   ├── gemini-client.ts    # MCP client (connection pool + fallback chain)
│   ├── seo-expert.ts       # Multi-language SEO with trend validation
│   ├── trends-hook.ts      # Google Trends authority scoring + decay
│   ├── shorts-extractor.ts # Emotional arc analysis + CTA injection
│   └── voice-matcher.ts    # Voice persona recommendation
├── infra/
│   ├── token-bucket.ts     # Rate limiting
│   └── priority-queue.ts   # Request priority management
├── utils/
│   ├── logger.ts           # Structured JSON logging
│   ├── retry.ts            # Exponential backoff
│   └── cost-tracker.ts     # Token usage tracking
└── index.ts                # Entry point (strict startup ordering)
```

## Setup

```bash
bun install
mkdir -p incoming active_projects data
```

## Usage

```bash
bun run src/index.ts
```

Drop `.md`, `.txt`, or `.markdown` files into `./incoming/` to trigger processing.

## Key Features

- **Multi-tier AI fallback** with automatic prompt simplification
- **Trend authority scoring** — keywords classified as fleeting/emerging/established with 24h decay
- **Forced trend coverage** — titles auto-regenerate if missing established keywords
- **Emotional arc analysis** for Shorts extraction (anger/awe/curiosity/fomo/validation)
- **CTA injection** matched to emotional triggers
- **Stale project recovery** via heartbeat monitoring
- **Cost tracking** with per-model token accounting
- **Structured logging** with project_id on every line
