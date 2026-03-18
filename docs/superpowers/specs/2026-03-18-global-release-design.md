# Newscrux Global Release — Design Spec

**Date:** 2026-03-18
**Status:** Draft
**Scope:** Internationalize, professionalize, and rename AiNews-Pushover to Newscrux for open-source release.

---

## Problem Statement

The project is currently hardcoded for Turkish: AI prompts, notification labels, startup messages, and README are all in Turkish. The package name (`rssfeedy-pi`) is internal. To release globally, the project needs multilingual summary support, English-first codebase, professional packaging, and a showcase-quality README.

## Scope

**In scope:**
- i18n system for AI summaries + notification labels (5 languages)
- CLI argument for language selection (`--lang`)
- Rename to Newscrux (package, service, user-agent, all references)
- Professional README (GitHub Showcase quality)
- StructuredSummary field rename (`title_tr` → `translated_title`)
- English-first codebase (all logs, errors, comments in English)

**Out of scope:**
- Relevance prompt i18n (stays English for model performance)
- Log message i18n (developer-facing, stays English)
- New RSS feeds or pipeline changes
- Docker support (future)
- GitHub repo creation/rename (user does this manually; package.json URLs assume `github.com/alicankiraz1/newscrux` — user creates the repo with that name)

---

## 1. i18n System

### New file: `src/i18n.ts`

Single file containing all language-dependent strings for 5 languages.

**Type definitions:**

```typescript
export type SupportedLanguage = 'en' | 'tr' | 'de' | 'fr' | 'es';

export interface LanguagePack {
  name: string; // "English", "Turkish", etc.

  // Summarizer system prompt builder
  summarySystemPrompt: (kindLabel: string, sourceType: string) => string;

  // Feed kind labels used in prompts
  kindLabels: Record<FeedKind, string>;

  // Notification UI labels
  labels: {
    whatHappened: string;
    whyItMatters: string;
    readMore: string;
    readArticle: string;
    startupMessage: string;
  };
}
```

**Language packs contain:**

For each of the 5 languages (en, tr, de, fr, es):

1. **`summarySystemPrompt`** — Full system prompt in that language instructing the model to:
   - Analyze the article
   - Output structured JSON with `translated_title`, `what_happened`, `why_it_matters`, `key_detail`, `source_type`
   - Enforce minimum lengths (what_happened >= 50 chars, why_it_matters >= 20 chars)
   - Use native technical terms where appropriate
   - Return only valid JSON

2. **`kindLabels`** — Feed kind names in that language:
   - en: `{ official_blog: 'official blog', media: 'news report', research: 'research paper', newsletter: 'technical newsletter' }`
   - tr: `{ official_blog: 'resmi blog/duyuru', media: 'medya haberi', research: 'araştırma makalesi', newsletter: 'teknik bülten' }`
   - (similar for de, fr, es)

3. **`labels`** — Notification template strings:
   - en: `{ whatHappened: 'What happened:', whyItMatters: 'Why it matters:', readMore: 'Read More', readArticle: 'Read Article', startupMessage: 'Newscrux started! AI news notifications active.' }`
   - tr: `{ whatHappened: 'Ne oldu:', whyItMatters: 'Neden önemli:', readMore: 'Devamını Oku', readArticle: 'Makaleyi Oku', startupMessage: 'Newscrux başlatıldı! AI haber bildirimleri aktif.' }`
   - (similar for de, fr, es)

**Export:** `getLanguagePack(lang: SupportedLanguage): LanguagePack` and `SUPPORTED_LANGUAGES` array.

### What stays English (not in i18n)

- Relevance filter prompt (`relevance.ts`) — model performs better with English scoring instructions. Output is numeric scores, not user-facing text.
- All log messages — developer-facing
- All error messages — developer-facing
- Code comments — developer-facing

---

## 2. CLI Argument Parsing

### New file: `src/cli.ts`

Minimal CLI parser using `process.argv` — no external dependencies.

**Supported flags:**

| Flag | Description | Default |
|------|-------------|---------|
| `-l, --lang <code>` | Summary language: en, tr, de, fr, es | `en` |
| `-h, --help` | Show help message and exit | — |
| `-v, --version` | Show version and exit | — |

**Behavior:**

- `parseArgs()` returns `{ lang: SupportedLanguage }`
- Invalid language code → error message listing supported languages + `process.exit(1)`
- `--help` → usage text (see Section 2 of design presentation) + `process.exit(0)`
- `--version` → reads version from package.json + `process.exit(0)`

**Help output format:**

```
Newscrux — AI-powered news aggregator with push notifications

Usage: newscrux [options]

Options:
  -l, --lang <code>   Summary language: en, tr, de, fr, es (default: "en")
  -h, --help          Show this help message
  -v, --version       Show version number

Environment variables (.env):
  OPENROUTER_API_KEY    OpenRouter API key (required)
  PUSHOVER_USER_KEY     Pushover user key (required)
  PUSHOVER_APP_TOKEN    Pushover app token (required)
  OPENROUTER_MODEL      AI model (default: deepseek/deepseek-v3.2-speciale)
  POLL_INTERVAL_MINUTES Poll interval in minutes (default: 15)

Examples:
  newscrux --lang=tr    Start with Turkish summaries
  newscrux -l de        Start with German summaries
  newscrux              Start with English summaries (default)
```

### Config integration

`config.ts` gets a new mutable field:

```typescript
language: SupportedLanguage  // set from CLI, default 'en'
```

`index.ts` calls `parseArgs()` before anything else and sets `config.language`.

---

## 3. StructuredSummary Field Rename

> **Note on `--version` implementation:** Since this is an ESM project, `__dirname` is not available. Use `import.meta.url` with `fileURLToPath` and `path.resolve` to locate `package.json` relative to the source file. Example: `const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');`

> **Note on `bin` entry:** `dist/index.js` needs a shebang line (`#!/usr/bin/env node`) as the first line for the `"bin"` entry in package.json to work when installed globally via npm.

`title_tr` → `translated_title` everywhere:

- `src/types.ts`: `StructuredSummary.translated_title`
- `src/summarizer.ts`: prompt JSON schema, validation, parsing
- `src/pushover.ts`: `summary.translated_title`
- `src/i18n.ts`: all 5 language prompt templates use `translated_title`
- `src/queue.ts`: `QueueEntry.structuredSummary` — no change needed (nested object)

**Migration note:** Existing `article-queue.json` files with `title_tr` in stored summaries will still work — `pushover.ts` should check for both `translated_title` and `title_tr` (fallback) when reading stored entries.

---

## 4. Consuming i18n in Existing Modules

### `src/summarizer.ts`

- Import `getLanguagePack` from `i18n.ts`
- Replace hardcoded Turkish `buildSystemPrompt()` with:
  ```typescript
  const pack = getLanguagePack(config.language);
  const kindLabel = pack.kindLabels[entry.feedKind];
  const prompt = pack.summarySystemPrompt(kindLabel, sourceType);
  ```
- Prompt instructs model to output `translated_title` (not `title_tr`)

### `src/pushover.ts`

- Import `getLanguagePack` from `i18n.ts`
- Replace hardcoded `'Ne oldu:'`, `'Neden önemli:'`, `'Devamını Oku'`, `'Makaleyi Oku'` with:
  ```typescript
  const { labels } = getLanguagePack(config.language);
  const whatLine = `\n\n<b>${labels.whatHappened}</b> ${whatHappened}`;
  const whyLine = `\n\n<b>${labels.whyItMatters}</b> ${whyItMatters}`;
  const urlTitle = isArxiv ? labels.readArticle : labels.readMore;
  ```

### `src/index.ts`

- Import `parseArgs` from `cli.ts`
- Call `parseArgs()` at start of `main()`, set `config.language`
- Replace hardcoded Turkish startup message with `getLanguagePack(config.language).labels.startupMessage`
- Replace `'RSSfeedy-Pi v2.0 starting...'` with `'Newscrux starting...'` (version read from package.json at startup, logged as `Newscrux v${version} starting...`)

### `src/relevance.ts`

- No i18n changes
- Update model reference: `config.openrouterModel` (already done)

---

## 5. Project Renaming

All references to `rssfeedy-pi` / `RSSfeedy-Pi` are replaced with `newscrux` / `Newscrux`.

### File changes:

| File | Change |
|------|--------|
| `package.json` | `"name": "newscrux"`, `"version": "2.0.0"`, add `"author"`, `"repository"`, `"keywords"`, `"bin"` |
| `rssfeedy-pi.service` | Rename to `newscrux.service`, update all internal references |
| `src/index.ts` | Log messages: `'Newscrux v2.0 starting...'` |
| `src/feeds.ts` | User-Agent: `'Newscrux/2.0'` |
| `src/extractor.ts` | User-Agent: `'Mozilla/5.0 (compatible; Newscrux/2.0)'` |
| `src/queue.ts` | Log module name stays `'queue'` (no change needed) |
| `.env.example` | Comment header update |
| `README.md` | Complete rewrite (see Section 6) |

### package.json target:

```json
{
  "name": "newscrux",
  "version": "2.0.0",
  "description": "AI-powered news aggregator with structured multilingual summaries and push notifications",
  "author": "Alican Kiraz",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/alicankiraz1/newscrux"
  },
  "homepage": "https://github.com/alicankiraz1/newscrux#readme",
  "bugs": {
    "url": "https://github.com/alicankiraz1/newscrux/issues"
  },
  "keywords": ["ai", "news", "rss", "pushover", "summarizer", "multilingual", "raspberry-pi", "typescript", "deepseek"],
  "bin": { "newscrux": "./dist/index.js" },
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  },
  "engines": { "node": ">=18.0.0" }
}
```

---

## 6. README — GitHub Showcase

Complete English rewrite. Structure:

```markdown
# 📡 Newscrux

> AI-powered news aggregator with structured multilingual summaries and push notifications

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)]()
[![Languages](https://img.shields.io/badge/Languages-5-orange)]()

## What It Does

Newscrux monitors 13 AI/ML RSS feeds, filters articles by relevance using AI,
extracts full article content when needed, generates structured summaries in your
chosen language, and delivers them as push notifications to your phone via Pushover.

## Notification Preview

**Before (v1):**
Title: 🤖 TechCrunch AI
Body: OpenAI'ın yeni agent aracı... (2 cümle, bağlam yok)

**After (v2 — English):**
Title: OpenAI announces enterprise agent toolkit
Body:
📰 TechCrunch AI

What happened: OpenAI released a new suite of tools for...
Why it matters: This could accelerate the enterprise agent...
💡 Initial access is being rolled out gradually...

## Features

- 🌍 **5 languages** — English, Turkish, German, French, Spanish
- 🧠 **Structured summaries** — What happened + Why it matters + Key detail
- 📰 **13 RSS sources** — OpenAI, Google AI, DeepMind, TechCrunch, arXiv, and more
- 🔍 **AI relevance filtering** — Only delivers news that matters
- 📄 **Hybrid content extraction** — RSS snippet first, full-text scraping when needed
- ⚡ **Article state pipeline** — discovered → enriched → summarized → sent
- 🔒 **No data loss** — Atomic writes, retry on failure, queue persistence
- 📊 **Operational metrics** — Per-cycle stats logged for monitoring
- 🏷️ **Feed typing** — Official blogs bypass relevance filter automatically

## Quick Start

\```bash
git clone https://github.com/alicankiraz1/newscrux.git
cd newscrux
npm install
cp .env.example .env   # Edit with your API keys
npm run build
npm start -- --lang=en  # or: tr, de, fr, es
\```

## Architecture

```
RSS Feeds (13 sources)
     │
     ▼
  Dedup → Queue (discovered)
     │
     ├─ Relevance Filter (normal priority)
     ├─ Bypass (high priority)
     │
     ▼
  Enrich (snippet or scrape)
     │
     ▼
  Summarize (structured JSON)
     │
     ▼
  Render Notification
     │
     ▼
  Send via Pushover → Mark Sent
```

## Supported Languages

| Code | Language | Example Title |
|------|----------|--------------|
| en | English | "OpenAI announces enterprise agent toolkit" |
| tr | Turkish | "OpenAI kurumsal agent araç setini duyurdu" |
| de | German | "OpenAI stellt Enterprise-Agent-Toolkit vor" |
| fr | French | "OpenAI annonce sa boîte à outils d'agents" |
| es | Spanish | "OpenAI anuncia kit de herramientas de agentes" |

## Configuration

### CLI Options

| Flag | Description | Default |
|------|-------------|---------|
| `--lang, -l` | Summary language | `en` |
| `--help, -h` | Show help | — |
| `--version, -v` | Show version | — |

### Environment Variables (.env)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | Yes | — | OpenRouter API key |
| `PUSHOVER_USER_KEY` | Yes | — | Pushover user key |
| `PUSHOVER_APP_TOKEN` | Yes | — | Pushover app token |
| `OPENROUTER_MODEL` | No | `deepseek/deepseek-v3.2-speciale` | AI model for summarization |
| `POLL_INTERVAL_MINUTES` | No | `15` | Minutes between feed checks |
| `MAX_ARTICLES_PER_POLL` | No | `10` | Max regular articles processed per cycle |
| `ARXIV_MAX_PER_POLL` | No | `15` | Max arXiv papers processed per cycle |
| `RELEVANCE_THRESHOLD` | No | `6` | Minimum relevance score (1-10) |
| `LOG_LEVEL` | No | `info` | Log level: debug, info, warn, error |

## RSS Sources

Derive from config.ts feeds array. Format:

| Source | Type | Priority |
|--------|------|----------|
| OpenAI News | official_blog | high |
| Google AI Blog | official_blog | high |
| Google DeepMind | official_blog | high |
| Hugging Face Blog | official_blog | normal |
| TechCrunch AI | media | normal |
| MIT Technology Review AI | media | normal |
| The Verge AI | media | normal |
| Ars Technica | media | normal |
| arXiv cs.CL | research | normal |
| arXiv cs.LG | research | normal |
| arXiv cs.AI | research | normal |
| Import AI | newsletter | normal |
| Ahead of AI | newsletter | normal |

## Deployment

### Raspberry Pi (systemd)
```bash
# Copy and edit service file
sudo cp newscrux.service /etc/systemd/system/
sudo nano /etc/systemd/system/newscrux.service  # adjust paths and --lang flag

# Enable and start
sudo systemctl enable newscrux
sudo systemctl start newscrux

# View logs
journalctl -u newscrux -f
```

### Any Linux Server

Same as Raspberry Pi — requires Node.js 18+, systemd, and network access to RSS feeds and APIs.

## How It Works

Derive from the pipeline in index.ts. One sentence per step:
1. **Fetch** — Polls 13 RSS feeds every 15 minutes
2. **Deduplicate** — Removes cross-source duplicates using title similarity
3. **Discover** — Adds new articles to the persistent queue
4. **Filter** — AI scores relevance 1-10, drops below threshold (high-priority sources bypass)
5. **Enrich** — Uses RSS snippet if long enough, otherwise scrapes full article with cheerio
6. **Summarize** — DeepSeek generates structured JSON: title, what happened, why it matters, key detail
7. **Render** — Builds notification with smart truncation and HTML escaping
8. **Send** — Delivers to Pushover, marks as sent only after successful delivery
9. **Retry** — Failed articles are retried next cycle (max 3 attempts)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

## Author

**Alican Kiraz**

[![LinkedIn](badge)](https://linkedin.com/in/alican-kiraz)
[![X](badge)](https://x.com/AlicanKiraz0)
[![Medium](badge)](https://alican-kiraz1.medium.com)
[![HuggingFace](badge)](https://huggingface.co/AlicanKiraz0)
[![GitHub](badge)](https://github.com/alicankiraz1)

## License

MIT — see [LICENSE](LICENSE)
```

---

## 7. Additional Files

### `CONTRIBUTING.md`

Short contribution guide:
1. Fork the repo
2. Create a feature branch
3. Make changes, ensure `npm run build` passes
4. Submit a PR

Guidelines: follow existing code style, keep files focused, English for all code/comments.

### `newscrux.service`

Renamed from `rssfeedy-pi.service`. Updated references:
- Description: `Newscrux AI News Push Notification Service`
- ExecStart uses `%h` systemd specifier for home directory: `ExecStart=/usr/bin/node %h/newscrux/dist/index.js --lang=en`
- WorkingDirectory: `%h/newscrux`
- Includes comment at top: `# Edit --lang= flag and paths to match your setup`

### `.env.example`

Updated with Newscrux branding and all current env vars.

---

## 8. File Changes Summary

| File | Change |
|------|--------|
| `src/i18n.ts` | **New file.** Language packs for 5 languages (prompts + labels). |
| `src/cli.ts` | **New file.** CLI argument parser (--lang, --help, --version). |
| `src/types.ts` | Rename `title_tr` to `translated_title` in StructuredSummary. Import and re-export `SupportedLanguage` from `i18n.ts`. |
| `src/config.ts` | Add `language: SupportedLanguage` field. |
| `src/summarizer.ts` | Use i18n language pack for system prompt. Update JSON field to `translated_title`. |
| `src/pushover.ts` | Use i18n labels for notification template. Read `translated_title` with `title_tr` fallback. |
| `src/index.ts` | Call `parseArgs()`, set config.language. Update branding to Newscrux. Use i18n startup message. |
| `src/feeds.ts` | Update User-Agent to `Newscrux/2.0`. |
| `src/extractor.ts` | Update User-Agent to `Newscrux/2.0`. |
| `package.json` | Rename to newscrux, add author/repo/keywords/bin, bump to 2.0.0. |
| `rssfeedy-pi.service` | **Deleted.** Replaced by `newscrux.service`. |
| `newscrux.service` | **New file.** Renamed systemd service with --lang flag. |
| `.env.example` | Updated branding and variable descriptions. |
| `README.md` | **Complete rewrite.** English, GitHub Showcase quality. |
| `CONTRIBUTING.md` | **New file.** Short contribution guide. |
| `LICENSE` | Update copyright name format (already correct). |

**No changes:** `src/queue.ts`, `src/dedup.ts`, `src/logger.ts`, `src/relevance.ts` (except model reference already updated).

---

## 9. Migration & Backward Compatibility

- Existing `article-queue.json` files with `title_tr` in stored summaries: `pushover.ts` checks for both `translated_title` and `title_tr` (fallback).
- Existing `.env` files work as-is. No env vars were removed.
- `--lang` defaults to `en` if not provided — English is the new default.
- Old `seen-articles.json` migration (from v1) still works via `queue.ts`.

---

## 10. Error Handling

| Scenario | Behavior |
|----------|----------|
| Invalid `--lang` value | Error message listing supported languages + exit(1) |
| Missing `--lang` flag | Default to `en` |
| `--help` or `--version` | Print info and exit(0) |
| Language pack missing field | TypeScript compile-time error (interface enforced) |
