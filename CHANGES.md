# Changes from Original (alicankiraz1/newscrux)

This document tracks all changes made to the original Newscrux repository.

## Unreleased — 2026-11-18

### Multi-channel notifications (F1)

- New `Notifier` interface in `src/notifiers/` with three implementations: `pushover`, `telegram`, `discord`.
- `NOTIFY_CHANNELS` selects the active channels (default `pushover`); every enabled channel is validated at startup and missing credentials abort with a clear message.
- Telegram gets an HTML payload (`parse_mode=HTML`) truncated to the 4096 character limit; Discord receives the rendered HTML converted to markdown and capped at 2000 characters.
- Article, arXiv-digest and startup notifications are fanned out to all configured channels; `--no-push` behaves exactly as before.
- 6 new fetch-mocked adapter tests (suite now 23 tests).

## Unreleased — 2026-11-04

### Audit follow-up (2026-10-17 findings)

#### Testing and CI
- Added **Vitest** with 17 unit tests covering the queue state machine, dedup, notification rendering/truncation, and queue schema validation (`tests/`).
- Added `npm run typecheck` (`tsc --noEmit`) and `npm test` / `npm run test:watch` scripts.
- Added `.github/workflows/ci.yml`: install → typecheck → test → build on every push/PR (`npm ci --include=dev`).

#### Security
- `/api/*` mutations (`POST`/`PUT`/`DELETE`) are now restricted:
  - loopback callers are trusted;
  - remote callers must send `API_TOKEN` (`Authorization: Bearer <token>` or `X-Api-Token`), otherwise `403`;
  - when `API_TOKEN` is configured, the token is always required (`401` otherwise).
- CORS is no longer `*`: only localhost origins plus `WEB_ALLOWED_ORIGINS` are allowed.
- The web server binds to `127.0.0.1` by default (`WEB_HOST` overrides), so `--web` no longer exposes the UI to the network unintentionally.

#### Reliability
- Queue file is now schema-validated on load. A corrupt/invalid file is **quarantined** to `article-queue.json.corrupt-<timestamp>` with an error log instead of being silently reset to an empty queue.
- `DATA_DIR` environment variable allows relocating the queue (also used by tests for isolation).

#### Observability
- Added `GET /metrics` (Prometheus text format): last poll-cycle counters plus queue state counts.

#### Documentation / hygiene
- Repaired the broken CLI-options markdown block and documented `--web` / `--port`.
- Removed stale Ollama/OpenRouter instructions; README now describes the central LLM gateway, Web UI/API routes, and the new environment variables.
- Moved the stale root `article-queue.json` test fixture to `archive/`.

#### Central LLM gateway
- All AI calls now go through the central Karargah gateway (`LLM_GATEWAY_URL`, default `http://127.0.0.1:7799`); the per-provider Ollama/OpenRouter path was removed (`src/ollama.ts` deleted, `src/llm.ts` added).

## Version 2.0.1 - 2026-03-19

### New Features

#### Ollama Local AI Integration
- Added support for using local AI models via Ollama
- Added `--provider` CLI flag (`-p ollama` or `openrouter`)
- Added `AI_PROVIDER` environment variable (default: `openrouter`)
- Created `src/ollama.ts` module with `callOllama()` function
- Ollama uses OpenAI-compatible endpoint at `http://localhost:11434/v1/chat/completions`
- Added `OLLAMA_BASE_URL` environment variable (default: `http://localhost:11434/v1`)
- Added `OLLAMA_MODEL` environment variable (default: `deepseek-qwen-8b:latest`)

#### Terminal-Only Mode
- Added `--no-push` CLI flag to skip Pushover notifications
- When `--no-push` is used, results are displayed in terminal with formatted output
- Disables automatic scheduling (runs once and exits)
- Removes Pushover API key requirement when `--no-push` is set
- Color-coded terminal output for better readability

### Code Changes

#### New Files
- `src/ollama.ts` - Ollama API integration module
- `AGENTS.md` - Agent documentation with build commands and code style guidelines

#### Modified Files
- `src/cli.ts` - Added `--provider` and `--no-push` flag parsing
- `src/config.ts` - Added OLLAMA_BASE_URL, OLLAMA_MODEL, AI_PROVIDER config
- `src/index.ts` - Added provider routing and no-push logic
- `src/summarizer.ts` - Added provider-based AI call routing
- `src/relevance.ts` - Added provider-based AI call routing
- `.env.example` - Added Ollama environment variables

### Configuration Updates

#### CLI Options
```
--provider <type>   AI provider: openrouter, ollama (default: "openrouter")
--no-push            Skip Pushover notifications, show results in terminal only
```

#### Environment Variables
```
AI_PROVIDER          AI provider: openrouter, ollama (default: openrouter)
OLLAMA_BASE_URL       Ollama API URL (default: http://localhost:11434/v1)
OLLAMA_MODEL          Ollama model name (default: deepseek-qwen-8b:latest)
```

### Usage Examples

#### Running with Ollama (Local AI)
```bash
# Install Ollama and pull a model
ollama pull deepseek-qwen-8b:latest
ollama serve

# Run Newscrux with Ollama
npm run dev -- -p ollama --lang=tr
```

#### Running in Terminal-Only Mode (No Pushover)
```bash
# Shows results in terminal, no notifications
npm run dev -- --no-push -p ollama --lang=tr
```

### Benefits

1. **Privacy** - No data sent to external AI services when using Ollama
2. **Cost Control** - Free local AI inference, no API costs
3. **Flexibility** - Choose between cloud (OpenRouter) or local (Ollama) AI
4. **Development** - Terminal-only mode useful for testing and development
5. **Data Control** - All processing happens locally with Ollama

### Technical Details

#### Provider Routing
Both `src/summarizer.ts` and `src/relevance.ts` now check `runtimeConfig.provider` to determine which AI service to call:
- `openrouter` → Uses `@openrouter/sdk` (original behavior)
- `ollama` → Uses `src/ollama.ts` with OpenAI-compatible endpoint

#### Runtime Configuration
```typescript
export const runtimeConfig: {
  language: SupportedLanguage,
  provider: 'openrouter' | 'ollama',
  noPush: boolean
}
```

### Compatibility

- Fully backward compatible with original OpenRouter setup
- Default behavior unchanged (uses OpenRouter unless specified)
- Pushover functionality unchanged when provider=openrouter

## Version 2.0.2 - 2026-03-19

### Performance and Reliability Improvements

#### Pipeline Throughput
- Reworked poll pipeline stages to support configurable bounded concurrency:
  - `ENRICH_CONCURRENCY`
  - `SUMMARIZE_CONCURRENCY`
  - `SEND_CONCURRENCY`
- Removed fixed per-item waits and replaced them with optional delay controls:
  - `SUMMARIZE_DELAY_MS`
  - `SEND_DELAY_MS`
- Added `SCRAPING_ENABLED` toggle for snippet-first fast mode.

#### Backlog Drain Control
- Relevance processing batch is now configurable with `RELEVANCE_BATCH_SIZE` (replacing hardcoded low batch behavior).
- This allows faster reduction of large discovered queues.

#### Queue Retry State Fix
- Fixed retry behavior for send failures:
  - If a summary already exists, failed send retries stay in `summarized` state.
  - Prevents unnecessary re-summarization loops and reduces model load.

#### Web UI Responsiveness
- Added asynchronous poll trigger mode for API:
  - `POST /api/poll?mode=async`
  - `GET /api/poll-status`
- Frontend now uses background polling flow instead of blocking on a single long HTTP request.

#### Ollama Robustness Hardening
- `src/ollama.ts` now parses multiple OpenAI-compatible response shapes more defensively.
- Added explicit generation controls:
  - `OLLAMA_THINK`
  - `OLLAMA_TEMPERATURE`
  - `OLLAMA_SUMMARY_MAX_TOKENS`
  - `OLLAMA_RELEVANCE_MAX_TOKENS`
  - `OLLAMA_TIMEOUT_MS`
  - `OLLAMA_MAX_RETRIES`
- Empty-content responses now include raw payload context in error logs for faster diagnosis.

#### Relevance Failure Fallback
- When relevance model output is not valid JSON, system now applies deterministic keyword-based fallback scoring.
- Replaces previous "allow all through" behavior to avoid noisy queue growth.

### Documentation Updates
- Updated `.env.example` with new performance and Ollama tuning variables.
- Updated `README.md` environment variable table with all added runtime controls.

### Validation
- TypeScript build verified after changes:
  - `npm run build` ✅
