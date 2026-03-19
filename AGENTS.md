# Newscrux Agent Instructions

This repository contains an AI-powered news aggregator with multilingual notifications and push alerts. All work should follow these conventions.

## Build and Development Commands

```bash
# Compile TypeScript (must pass before submitting)
npm run build

# Run production build
npm start

# Run in development mode with hot reloading
npm run dev

# Run with specific language (en, tr, de, fr, es)
npm run dev -- --lang=tr
```

**No test framework is configured** — manual testing with `npm run dev` is required.

## TypeScript Configuration

- **Strict mode enabled** — no implicit `any`
- ESM modules (`.js` extensions required in imports)
- Node.js built-ins imported from `node:` prefix: `import { readFileSync } from 'node:fs'`
- Target: ES2022, Module: NodeNext
- Output directory: `./dist`

## Code Style

### Imports
```typescript
// Third-party imports first
import Parser from 'rss-parser';
import { OpenRouter } from '@openrouter/sdk';

// Then local imports (type imports use 'type' keyword)
import { config, runtimeConfig } from './config.js';
import { createLogger } from './logger.js';
import type { Article, FeedConfig } from './types.js';
```

### Naming Conventions
- **Variables/Functions/Exports**: camelCase
- **Interfaces/Types**: PascalCase
- **Constants**: UPPER_SNAKE_CASE
- **Module names**: lowercase with kebab-case (e.g., `queue.ts`, `article-queue.json`)
- **Files**: lowercase with kebab-case (`summarizer.ts`, `dedup.ts`)

### Formatting
- 2-space indentation
- Use semicolons
- Double quotes for strings
- File header comment: `// src/filename.ts`
- Arrow functions for callbacks
- `const` by default, `let` only when reassignment needed

### Type Definitions
```typescript
// Define all interfaces/types in src/types.ts
export interface Article {
  id: string;
  title: string;
  link: string;
  // ...
}

// Use const assertions for config arrays
feeds: [
  { name: '...', url: '...', kind: 'official_blog', priority: 'high' },
] satisfies FeedConfig[]

// Use type imports
import type { QueueEntry, ArticleState } from './types.js';
```

## Error Handling

```typescript
// Use try-catch for async operations
async function fetchFeed(feed: FeedConfig): Promise<Article[]> {
  try {
    const parsed = await parser.parseURL(feed.url);
    return /* ... */;
  } catch (err) {
    log.error(`Failed to fetch feed: ${feed.name}`, err);
    return []; // Graceful degradation
  }
}

// Retry with exponential backoff
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  try {
    const result = await operation();
    return result;
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await delay(Math.pow(2, attempt + 1) * 1000);
    } else {
      log.error(`Operation failed after retries`, err);
      throw err;
    }
  }
}
```

## Logging

```typescript
// Create logger at module level
import { createLogger } from './logger.js';

const log = createLogger('module-name'); // Use filename or domain

log.debug('Verbose details for debugging');
log.info('Normal flow events');
log.warn('Recoverable issues');
log.error('Errors with context', err); // Always pass error object
```

## State Management

Article state machine: `discovered → enriched → summarized → sent | failed`

```typescript
import {
  transitionEntry,
  markFailed,
  getEntriesByState,
  loadArticleQueue,
  saveArticleQueue,
} from './queue.js';

// Load queue at cycle start
loadArticleQueue();

// Get entries by state
const discovered = getEntriesByState('discovered');

// Transition to new state
transitionEntry(entry.id, 'enriched', { enrichedContent: content });

// Mark as failed with retry logic
markFailed(entry.id, 'Operation failed: ${error}');

// Persist queue after changes
saveArticleQueue();
```

## Atomic Writes

For persistence, use atomic write pattern:
```typescript
import { writeFileSync, renameSync } from 'node:fs';

const tmpFile = filePath + '.tmp';
writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
renameSync(tmpFile, filePath);
```

## API Integration

```typescript
// Use OpenRouter SDK for AI
import { OpenRouter } from '@openrouter/sdk';

const openrouter = new OpenRouter({ apiKey: config.openrouterApiKey });
const result = await openrouter.chat.send({
  model: config.openrouterModel,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ],
});
```

## Configuration

- All config in `src/config.ts` — read-only for modules
- Runtime mutable config in `runtimeConfig` (e.g., language from CLI)
- Environment variables loaded via `dotenv/config`
- Type-safe access: `config.openrouterApiKey`

## File Organization

- **One clear responsibility per file**
- Export public API, keep implementation private
- Group related functions together
- Use `export` for public functions, `export type` for types

## Adding New Features

1. Add types to `src/types.ts`
2. Implement in appropriate module
3. Update `src/config.ts` if needed
4. Test with `npm run dev`
5. Ensure `npm run build` passes

## Important Constants

- `SNIPPET_MAX_CHARS = 1500` — RSS snippet limit
- `enrichedContentMaxLength = 3000` — Content sent to AI
- `relevanceThreshold = 6` — Default AI relevance threshold
- `ARXIV_DIGEST_INTERVAL_MS = 60 * 60 * 1000` — 1 hour

## Concurrency Patterns

- Use `Promise.allSettled()` for parallel fetch operations
- Add delays between AI requests (`await new Promise(r => setTimeout(r, 2000))`)
- Respect rate limits for scraping operations
