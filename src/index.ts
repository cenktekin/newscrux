#!/usr/bin/env node
// src/index.ts
import { config, runtimeConfig } from './config.js';
import { createLogger } from './logger.js';
import { fetchAllArticles } from './feeds.js';
import { filterByRelevance } from './relevance.js';
import { enrichEntry } from './extractor.js';
import { summarizeEntry } from './summarizer.js';
import {
  loadArticleQueue,
  saveArticleQueue,
  getQueue,
  isKnown,
  discoverArticles,
  handleColdStart,
  getEntriesByState,
  transitionEntry,
  markFailed,
  removeEntry,
  countByState,
} from './queue.js';
import { sendNotification, sendArticleNotification, escapeHtml } from './pushover.js';
import { parseArgs } from './cli.js';
import { getLanguagePack } from './i18n.js';
import { createApi } from './api.js';
import { initializeFromConfig, getFeeds } from './feeds-manager.js';
import type { PollMetrics } from './types.js';

const log = createLogger('main');

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;

  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  let currentIndex = 0;

  const runner = async () => {
    while (true) {
      const index = currentIndex++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  };

  await Promise.all(Array.from({ length: safeConcurrency }, () => runner()));
}

function validateConfig(): void {
  if (runtimeConfig.provider === 'openrouter' && !config.openrouterApiKey) {
    log.error('OPENROUTER_API_KEY is required when provider=openrouter. Set it in .env file.');
    process.exit(1);
  }
  if (!runtimeConfig.noPush && (!config.pushoverUserKey || !config.pushoverAppToken)) {
    log.error('PUSHOVER_USER_KEY and PUSHOVER_APP_TOKEN are required. Set them in .env file or use --no-push.');
    process.exit(1);
  }
}

let pollCycleCount = 0;
let lastArxivDigestTime = 0;
const ARXIV_DIGEST_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function emitMetrics(metrics: PollMetrics): void {
  const parts = Object.entries(metrics)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  log.info(`[METRICS] poll_cycle=${pollCycleCount} ${parts}`);
}

export interface PollResult {
  summaries: Array<{
    id: string;
    title: string;
    feedName: string;
    link: string;
    whatHappened: string;
    whyItMatters: string;
    keyDetail: string;
    isArxiv: boolean;
  }>;
  metrics: PollMetrics;
  status: 'success' | 'no_new_articles' | 'cold_start';
}

export async function pollAndNotify(): Promise<PollResult> {
  const result: PollResult = {
    summaries: [],
    metrics: {
      discovered: 0,
      enriched: 0,
      enrichment_scraped: 0,
      enrichment_snippet: 0,
      relevance_passed: 0,
      relevance_dropped: 0,
      relevance_bypassed: 0,
      summarized: 0,
      summary_failed: 0,
      sent: 0,
      send_failed: 0,
      truncated: 0,
      queue_pending: 0,
      queue_failed: 0,
    },
    status: 'success',
  };

  const metrics = result.metrics;
  pollCycleCount++;
  log.info('Starting poll cycle...');

  try {
    loadArticleQueue();

    const allArticles = await fetchAllArticles();

    if (handleColdStart(allArticles)) {
      log.info('Cold start complete — no notifications this cycle');
      emitMetrics(metrics);
      result.status = 'cold_start';
      return result;
    }

    const newCount = discoverArticles(allArticles);
    metrics.discovered = newCount;
    saveArticleQueue();

    if (newCount === 0 && getEntriesByState('discovered').length === 0 && getEntriesByState('enriched').length === 0 && getEntriesByState('summarized').length === 0) {
      log.info('No new or pending articles');
      emitMetrics(metrics);
      result.status = 'no_new_articles';
      return result;
    }

    const relevancePassedIds = new Set<string>();
    // Limit discovered batch to prevent overwhelming the relevance model
    const maxRelevanceBatch = config.relevanceBatchSize;
    const allDiscovered = getEntriesByState('discovered');
    const discovered = allDiscovered.slice(0, maxRelevanceBatch);

    if (allDiscovered.length > maxRelevanceBatch) {
      log.info(`Processing ${discovered.length}/${allDiscovered.length} discovered articles this cycle`);
    }

    if (discovered.length > 0) {
      const result = await filterByRelevance(discovered);

      metrics.relevance_bypassed = result.bypassed.length;
      metrics.relevance_passed = result.passed.length;
      metrics.relevance_dropped = result.dropped.length;

      for (const { entry } of result.dropped) {
        removeEntry(entry.id);
      }

      for (const entry of result.passed) relevancePassedIds.add(entry.id);
      for (const entry of result.bypassed) relevancePassedIds.add(entry.id);

      if (result.parseError) {
        log.warn('Relevance parse error — allowing all entries through this cycle');
        for (const entry of discovered) {
          relevancePassedIds.add(entry.id);
        }
      }

      saveArticleQueue();
    }

    const isArxiv = (name: string) => name.startsWith(config.arxivFeedPrefix);
    const eligibleForEnrich = getEntriesByState('discovered').filter(e => relevancePassedIds.has(e.id));
    const regularToEnrich = eligibleForEnrich.filter(e => !isArxiv(e.feedName));
    const arxivToEnrich = eligibleForEnrich.filter(e => isArxiv(e.feedName));

    const enrichBatch = [
      ...regularToEnrich.slice(0, config.maxArticlesPerPoll),
      ...arxivToEnrich.slice(0, config.arxivMaxPerPoll),
    ];

    await runWithConcurrency(enrichBatch, config.enrichConcurrency, async (entry) => {
      try {
        const { enrichedContent, wasScraped } = await enrichEntry(entry);
        transitionEntry(entry.id, 'enriched', { enrichedContent });
        metrics.enriched++;
        if (wasScraped) metrics.enrichment_scraped++;
        else metrics.enrichment_snippet++;
      } catch (err) {
        markFailed(entry.id, `Enrichment error: ${err}`);
      }
    });
    saveArticleQueue();

    const toSummarize = getEntriesByState('enriched');
    await runWithConcurrency(toSummarize, config.summarizeConcurrency, async (entry) => {
      const summary = await summarizeEntry(entry);
      if (summary) {
        transitionEntry(entry.id, 'summarized', { structuredSummary: summary });
        metrics.summarized++;
      } else {
        markFailed(entry.id, 'Summarization failed');
        metrics.summary_failed++;
      }
      await delay(config.summarizeDelayMs);
    });
    saveArticleQueue();

    const toSend = getEntriesByState('summarized');
    const regularToSend = toSend.filter(e => !isArxiv(e.feedName));
    const arxivToSend = toSend.filter(e => isArxiv(e.feedName));

    const { labels } = getLanguagePack(runtimeConfig.language);

    if (runtimeConfig.noPush) {
      for (const entry of regularToSend) {
        if (!entry.structuredSummary) {
          markFailed(entry.id, 'No structured summary available');
          metrics.send_failed++;
          continue;
        }

        const s = entry.structuredSummary;
        result.summaries.push({
          id: entry.id,
          title: s.translated_title || entry.title,
          feedName: entry.feedName,
          link: entry.link,
          whatHappened: s.what_happened,
          whyItMatters: s.why_it_matters,
          keyDetail: s.key_detail,
          isArxiv: false,
        });

        transitionEntry(entry.id, 'sent');
        metrics.sent++;
      }
      saveArticleQueue();
    } else {
      await runWithConcurrency(regularToSend, config.sendConcurrency, async (entry) => {
        if (!entry.structuredSummary) {
          markFailed(entry.id, 'No structured summary available');
          metrics.send_failed++;
          return;
        }

        const { success, truncated } = await sendArticleNotification(entry, entry.structuredSummary);
        if (success) {
          transitionEntry(entry.id, 'sent');
          metrics.sent++;
          if (truncated) metrics.truncated++;
        } else {
          markFailed(entry.id, 'Pushover send failed');
          metrics.send_failed++;
        }

        await delay(config.sendDelayMs);
      });
    }

    const now = Date.now();
    const arxivReady = arxivToSend.filter(e => e.structuredSummary);

    if (runtimeConfig.noPush) {
      for (const entry of arxivReady) {
        const s = entry.structuredSummary!;
        result.summaries.push({
          id: entry.id,
          title: s.translated_title || entry.title,
          feedName: entry.feedName,
          link: entry.link,
          whatHappened: s.what_happened,
          whyItMatters: '',
          keyDetail: '',
          isArxiv: true,
        });

        transitionEntry(entry.id, 'sent');
        metrics.sent++;
      }
    } else {
      if (arxivReady.length > 0 && (now - lastArxivDigestTime) >= ARXIV_DIGEST_INTERVAL_MS) {
        const { labels } = getLanguagePack(runtimeConfig.language);

        const digestParts: string[] = [];
        for (const entry of arxivReady) {
          const s = entry.structuredSummary!;
          const title = s.translated_title || (s as any).title_tr || entry.title;
          digestParts.push(`<b>${escapeHtml(title)}</b>\n${escapeHtml(s.what_happened)}`);
        }

        let digestMessage = '';
        let includedCount = 0;
        for (const part of digestParts) {
          const candidate = digestMessage ? digestMessage + '\n\n' + part : part;
          if (candidate.length > 1000) break;
          digestMessage = candidate;
          includedCount++;
        }

        const digestTitle = `📄 arXiv Digest (${includedCount} ${includedCount === 1 ? 'paper' : 'papers'})`;
        const success = await sendNotification(digestTitle, digestMessage, 'https://arxiv.org', labels.readMore);

        if (success) {
          for (const entry of arxivReady) {
            transitionEntry(entry.id, 'sent');
            metrics.sent++;
          }
          lastArxivDigestTime = now;
          log.info(`arXiv digest sent: ${includedCount} papers in message, ${arxivReady.length} total marked sent`);
        } else {
          for (const entry of arxivReady) {
            markFailed(entry.id, 'arXiv digest send failed');
            metrics.send_failed++;
          }
        }
      } else if (arxivReady.length > 0) {
        log.info(`arXiv: ${arxivReady.length} papers waiting for next digest (${Math.round((ARXIV_DIGEST_INTERVAL_MS - (now - lastArxivDigestTime)) / 60000)}min remaining)`);
      }
    }

    saveArticleQueue();

    const counts = countByState();
    metrics.queue_pending = counts.discovered + counts.enriched + counts.summarized;
    metrics.queue_failed = counts.failed;

    emitMetrics(metrics);
    log.info(`Poll cycle complete: ${metrics.sent} sent, ${metrics.queue_pending} pending`);
    return result;
  } catch (err) {
    log.error('Error in poll cycle', err);
    saveArticleQueue();
    return result;
  }
}

function scheduleNextPoll(): void {
  const intervalMs = config.pollIntervalMinutes * 60 * 1000;
  log.info(`Next poll in ${config.pollIntervalMinutes} minutes`);
  setTimeout(async () => {
    await pollAndNotify();
    scheduleNextPoll();
  }, intervalMs);
}

function setupShutdown(): void {
  const shutdown = (signal: string) => {
    log.info(`Received ${signal}, shutting down...`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function main(): Promise<void> {
  const args = parseArgs();
  runtimeConfig.language = args.lang;
  runtimeConfig.provider = args.provider;
  runtimeConfig.noPush = args.noPush;

  const pack = getLanguagePack(runtimeConfig.language);
  log.info(`Newscrux v2.0 starting... (language: ${pack.name}, provider: ${runtimeConfig.provider}, noPush: ${runtimeConfig.noPush})`);
  validateConfig();
  setupShutdown();

  initializeFromConfig(config.feeds);

  if (args.web) {
    const app = createApi();
    const port = args.port || 3000;
    app.listen(port, () => {
      log.info(`Web server running on http://localhost:${port}`);
    });

    if (!runtimeConfig.noPush) {
      await sendNotification(
        '📡 Newscrux',
        pack.labels.startupMessage,
      );
    }

    return;
  }

  if (!runtimeConfig.noPush) {
    const startupSent = await sendNotification(
      '📡 Newscrux',
      pack.labels.startupMessage,
    );

    if (startupSent) {
      log.info('Startup notification sent');
    } else {
      log.error('Failed to send startup notification — check Pushover credentials');
    }
  }

  await pollAndNotify();

  if (!runtimeConfig.noPush) {
    scheduleNextPoll();
  } else {
    log.info('Single run complete (no scheduling). Exiting.');
  }
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
