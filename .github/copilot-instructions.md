# Copilot Instructions for Newscrux

## Build, test, and lint commands

- Install dependencies: `npm install`
- Build TypeScript (required before submitting): `npm run build`
- Run production build: `npm start`
- Run in development mode: `npm run dev`
- Run in development mode with language override: `npm run dev -- --lang=tr`
- Run once without Pushover notifications: `npm run dev -- --no-push`

This repository currently has no configured test runner or lint script in `package.json`.

- Full validation path used by contributors: `npm run build` and manual run with `npm run dev`
- Single-test command: not available (no test framework configured)

## High-level architecture

Newscrux is a poll-and-process pipeline for AI/ML news with optional web API management.

### Main runtime flow

`src/index.ts` orchestrates each poll cycle:

1. Load persistent queue (`loadArticleQueue`)
2. Fetch all RSS items from configured feeds (`fetchAllArticles` in `src/feeds.ts`)
3. Deduplicate cross-source stories (`deduplicateArticles` in `src/dedup.ts`)
4. Discover new entries into queue (`discoverArticles`)
5. Relevance filtering (`filterByRelevance` in `src/relevance.ts`)
   - high-priority feeds bypass relevance scoring
6. Content enrichment (`enrichEntry` in `src/extractor.ts`)
   - use snippet when long enough
   - scrape article when snippet is short
7. Structured summarization (`summarizeEntry` in `src/summarizer.ts`)
8. Delivery (`sendArticleNotification` in `src/pushover.ts`) or terminal output when `--no-push`
9. Mark queue states and emit metrics

Queue state machine is:

`discovered -> enriched -> summarized -> sent | failed`

### Persistence model

- Queue data is persisted as JSON under `data/article-queue.json` via `src/queue.ts`
- Writes use atomic `*.tmp` + rename pattern
- Legacy migration exists from `seen-articles.json`
- Failed entries retry up to `MAX_RETRIES` before being marked permanent `failed`
- Cleanup removes old `sent` entries and terminally failed entries

### AI provider abstraction

- Runtime provider is selected by CLI/env: `openrouter` or `ollama`
- Relevance and summarization both branch on provider (`src/relevance.ts`, `src/summarizer.ts`)
- `runtimeConfig` (mutable) is set once from CLI args (`src/cli.ts`), while `config` is env-backed constants (`src/config.ts`)

### Feed management and web mode

- Feed defaults are declared in `src/config.ts`
- Persistent feed CRUD is in `src/feeds-manager.ts`, backed by `feeds.json`
- `initializeFromConfig` seeds `feeds.json` once when empty
- API/web mode (`--web`) starts Express server from `src/api.ts` and serves:
  - feed CRUD endpoints
  - OPML import/export
  - manual poll trigger endpoint
  - static UI from `public/`

### Notification behavior details

- Standard articles are sent individually
- arXiv entries are grouped and sent as an hourly digest
- Notification body is HTML-escaped and length-managed to Pushover limits

## Key repository conventions

- TypeScript strict mode is enabled (`tsconfig.json`), ESM with `NodeNext`
- Local imports must include `.js` extension in TypeScript source
- Node built-ins are imported with `node:` prefix
- Keep shared interfaces/types in `src/types.ts`
- Use `createLogger("<module>")` per module and pass error objects on `log.error`
- Keep one clear responsibility per file; follow existing module boundaries
- Use queue helpers from `src/queue.ts` for all article lifecycle updates (avoid ad hoc state mutation)
- Preserve feed priority semantics:
  - `official_blog` high-priority entries bypass relevance filtering
- Preserve arXiv behavior:
  - arXiv detection by feed name prefix from config
  - separate per-poll enrichment limit and digest send cadence
- Maintain multilingual contract via `src/i18n.ts` language packs:
  - summary output schema requires `translated_title`, `what_happened`, `why_it_matters`, `key_detail`, `source_type`
- Prefer graceful degradation in external I/O paths (feeds, scraping, AI calls, push) with structured logging and retry/backoff where already implemented
