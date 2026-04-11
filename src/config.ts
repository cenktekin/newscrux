// src/config.ts
import 'dotenv/config';
import { join } from 'node:path';
import type { FeedConfig } from './types.js';
import type { SupportedLanguage } from './i18n.js';

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
}

function toFloatInRange(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export const config = {
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openrouterModel: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v3.2-speciale',
  pushoverUserKey: process.env.PUSHOVER_USER_KEY || '',
  pushoverAppToken: process.env.PUSHOVER_APP_TOKEN || '',
  pollIntervalMinutes: toPositiveInt(process.env.POLL_INTERVAL_MINUTES, 15),
  maxArticlesPerPoll: toPositiveInt(process.env.MAX_ARTICLES_PER_POLL, 10),
  logLevel: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
  dataDir: join(process.cwd(), 'data'),

  /** Per-poll processing limit for arXiv articles (overflow stays in queue) */
  arxivMaxPerPoll: toPositiveInt(process.env.ARXIV_MAX_PER_POLL, 15),
  /** Feed name prefix to identify arXiv feeds */
  arxivFeedPrefix: 'arXiv ',

  /** AI relevance score threshold (1-10). Articles below this are filtered out. */
  relevanceThreshold: toPositiveInt(process.env.RELEVANCE_THRESHOLD, 6),
  /** Max discovered entries scored by relevance in one cycle */
  relevanceBatchSize: toPositiveInt(process.env.RELEVANCE_BATCH_SIZE, 100),

  /** Minimum snippet length to skip scraping (chars) */
  snippetMinLength: toPositiveInt(process.env.SNIPPET_MIN_LENGTH, 300),
  /** Max enriched content length sent to summarizer (chars) */
  enrichedContentMaxLength: toPositiveInt(process.env.ENRICHED_CONTENT_MAX_LENGTH, 3000),
  /** Enable full-page scraping when snippets are short */
  scrapingEnabled: toBool(process.env.SCRAPING_ENABLED, true),
  /** Scraping timeout per request (ms) */
  scrapingTimeoutMs: toPositiveInt(process.env.SCRAPING_TIMEOUT_MS, 10000),
  /** Rate limit delay between scraping requests to same domain (ms) */
  scrapingDomainDelayMs: toNonNegativeInt(process.env.SCRAPING_DOMAIN_DELAY_MS, 2000),

  /** Parallel worker counts for pipeline stages */
  enrichConcurrency: toPositiveInt(process.env.ENRICH_CONCURRENCY, 4),
  summarizeConcurrency: toPositiveInt(process.env.SUMMARIZE_CONCURRENCY, 2),
  sendConcurrency: toPositiveInt(process.env.SEND_CONCURRENCY, 3),
  /** Optional delay after summarization/send operation (ms) */
  summarizeDelayMs: toNonNegativeInt(process.env.SUMMARIZE_DELAY_MS, 0),
  sendDelayMs: toNonNegativeInt(process.env.SEND_DELAY_MS, 0),

  /** AI provider: 'openrouter' or 'ollama' */
  aiProvider: (process.env.AI_PROVIDER || 'openrouter') as 'openrouter' | 'ollama',
  /** Ollama base URL (default: http://localhost:11434/v1) */
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  /** Ollama model name (default: deepseek-qwen-8b:latest) */
  ollamaModel: process.env.OLLAMA_MODEL || 'deepseek-qwen-8b:latest',
  /** Ollama generation params */
  ollamaTemperature: toFloatInRange(process.env.OLLAMA_TEMPERATURE, 0.2, 0, 2),
  ollamaThink: toBool(process.env.OLLAMA_THINK, false),
  ollamaSummaryMaxTokens: toPositiveInt(process.env.OLLAMA_SUMMARY_MAX_TOKENS, 260),
  ollamaRelevanceMaxTokens: toPositiveInt(process.env.OLLAMA_RELEVANCE_MAX_TOKENS, 1200),
  ollamaTimeoutMs: toPositiveInt(process.env.OLLAMA_TIMEOUT_MS, 45000),
  ollamaMaxRetries: toNonNegativeInt(process.env.OLLAMA_MAX_RETRIES, 2),

  feeds: [
    // Official blogs (high priority — bypass relevance filter)
    { name: 'OpenAI News', url: 'https://openai.com/news/rss.xml', kind: 'official_blog', priority: 'high' },
    { name: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/', kind: 'official_blog', priority: 'high' },
    { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', kind: 'official_blog', priority: 'high' },
    { name: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', kind: 'official_blog', priority: 'normal' },
    // Media
    { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', kind: 'media', priority: 'normal' },
    { name: 'MIT Technology Review AI', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed/', kind: 'media', priority: 'normal' },
    { name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', kind: 'media', priority: 'normal' },
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', kind: 'media', priority: 'normal' },
    // Research
    { name: 'arXiv cs.CL', url: 'http://export.arxiv.org/rss/cs.CL', kind: 'research', priority: 'normal' },
    { name: 'arXiv cs.LG', url: 'http://export.arxiv.org/rss/cs.LG', kind: 'research', priority: 'normal' },
    { name: 'arXiv cs.AI', url: 'http://export.arxiv.org/rss/cs.AI', kind: 'research', priority: 'normal' },
    // Newsletters
    { name: 'Import AI', url: 'https://importai.substack.com/feed', kind: 'newsletter', priority: 'normal' },
    { name: 'Ahead of AI', url: 'https://magazine.sebastianraschka.com/feed', kind: 'newsletter', priority: 'normal' },
  ] satisfies FeedConfig[],
} as const;

// Mutable runtime config (set by CLI args at startup)
export const runtimeConfig: { language: SupportedLanguage; provider: 'openrouter' | 'ollama'; noPush: boolean } = {
  language: 'en',
  provider: 'openrouter',
  noPush: false,
};
