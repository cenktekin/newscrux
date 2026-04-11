// src/api.ts
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { resolve } from 'node:path';
import { getFeeds, addFeed, updateFeed, deleteFeed, initializeFromConfig } from './feeds-manager.js';
import { parseOpml, generateOpml } from './opml.js';
import { pollAndNotify } from './index.js';
import { createLogger } from './logger.js';
import { config } from './config.js';
import { getEntriesByState, getQueue } from './queue.js';
import type { FeedConfig } from './types.js';
import type { PollResult } from './index.js';

const log = createLogger('api');

interface PollJobState {
  status: 'idle' | 'running' | 'completed' | 'failed';
  startedAt: number | null;
  finishedAt: number | null;
  result: PollResult | null;
  error: string | null;
}

export function createApi() {
  const app = express();
  let activePollPromise: Promise<void> | null = null;
  const pollJobState: PollJobState = {
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
  };

  const runPollInBackground = () => {
    if (activePollPromise) {
      return false;
    }
    pollJobState.status = 'running';
    pollJobState.startedAt = Date.now();
    pollJobState.finishedAt = null;
    pollJobState.error = null;
    pollJobState.result = null;

    activePollPromise = (async () => {
      try {
        log.info('Background poll triggered via API');
        const result = await pollAndNotify();
        pollJobState.result = result;
        pollJobState.status = 'completed';
      } catch (err) {
        pollJobState.status = 'failed';
        pollJobState.error = err instanceof Error ? err.message : String(err);
        log.error('Error during background poll', err);
      } finally {
        pollJobState.finishedAt = Date.now();
        activePollPromise = null;
      }
    })();

    return true;
  };

  app.use(cors());
  app.use(express.json());
  app.use(express.static(resolve(process.cwd(), 'public')));

  app.get('/api/feeds', (_req: Request, res: Response) => {
    try {
      const feeds = getFeeds();
      res.json(feeds);
    } catch (err) {
      log.error('Error fetching feeds', err);
      res.status(500).json({ error: 'Failed to fetch feeds' });
    }
  });

  app.post('/api/feeds', (req: Request, res: Response) => {
    try {
      const { name, url, kind, priority }: Omit<FeedConfig, 'id'> = req.body;
      
      if (!name || !url || !kind || !priority) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const feed = addFeed({ name, url, kind, priority });
      res.status(201).json(feed);
    } catch (err) {
      log.error('Error adding feed', err);
      res.status(500).json({ error: 'Failed to add feed' });
    }
  });

  app.put('/api/feeds/:id', (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const updates: Partial<Omit<FeedConfig, 'id'>> = req.body;
      
      const feed = updateFeed(id, updates);
      if (!feed) {
        return res.status(404).json({ error: 'Feed not found' });
      }

      res.json(feed);
    } catch (err) {
      log.error('Error updating feed', err);
      res.status(500).json({ error: 'Failed to update feed' });
    }
  });

  app.delete('/api/feeds/:id', (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const success = deleteFeed(id);
      if (!success) {
        return res.status(404).json({ error: 'Feed not found' });
      }
      res.status(204).send();
    } catch (err) {
      log.error('Error deleting feed', err);
      res.status(500).json({ error: 'Failed to delete feed' });
    }
  });

  app.post('/api/feeds/import-opml', (req: Request, res: Response) => {
    try {
      const { opml, title }: { opml: string; title?: string } = req.body;
      
      if (!opml) {
        return res.status(400).json({ error: 'OPML content is required' });
      }

      const feeds = parseOpml(opml);
      let addedCount = 0;
      for (const feed of feeds) {
        addFeed(feed);
        addedCount++;
      }

      log.info(`Imported ${addedCount} feeds from OPML`);
      res.json({ imported: addedCount, feeds: getFeeds() });
    } catch (err) {
      log.error('Error importing OPML', err);
      res.status(500).json({ error: 'Failed to import OPML' });
    }
  });

  app.get('/api/feeds/export-opml', (req: Request, res: Response) => {
    try {
      const feeds = getFeeds();
      const title = req.query.title as string | undefined;
      const opml = generateOpml(feeds, title);
      
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="feeds.opml"');
      res.send(opml);
    } catch (err) {
      log.error('Error exporting OPML', err);
      res.status(500).json({ error: 'Failed to export OPML' });
    }
  });

  app.post('/api/poll', async (req: Request, res: Response) => {
    const mode = req.query.mode === 'sync' ? 'sync' : 'async';

    if (mode === 'async') {
      const started = runPollInBackground();
      if (!started) {
        return res.status(202).json({
          accepted: false,
          status: 'running',
          startedAt: pollJobState.startedAt,
        });
      }
      return res.status(202).json({
        accepted: true,
        status: 'running',
        startedAt: pollJobState.startedAt,
      });
    }

    try {
      if (pollJobState.status === 'running') {
        return res.status(409).json({ error: 'A poll is already running' });
      }
      log.info('Manual sync poll triggered via API');
      const result = await pollAndNotify();
      pollJobState.status = 'completed';
      pollJobState.startedAt = Date.now();
      pollJobState.finishedAt = Date.now();
      pollJobState.result = result;
      pollJobState.error = null;
      res.json(result);
    } catch (err) {
      pollJobState.status = 'failed';
      pollJobState.finishedAt = Date.now();
      pollJobState.error = err instanceof Error ? err.message : String(err);
      log.error('Error during manual poll', err);
      res.status(500).json({ error: 'Poll failed' });
    }
  });

  app.get('/api/poll-status', (_req: Request, res: Response) => {
    res.json({
      status: pollJobState.status,
      startedAt: pollJobState.startedAt,
      finishedAt: pollJobState.finishedAt,
      error: pollJobState.error,
      result: pollJobState.result,
    });
  });

  app.get('/api/queue-status', (_req: Request, res: Response) => {
    try {
      const counts = {
        discovered: getEntriesByState('discovered').length,
        enriched: getEntriesByState('enriched').length,
        summarized: getEntriesByState('summarized').length,
        sent: getEntriesByState('sent').length,
        failed: getEntriesByState('failed').length,
      };
      res.json(counts);
    } catch (err) {
      log.error('Error fetching queue status', err);
      res.status(500).json({ error: 'Failed to fetch queue status' });
    }
  });

  app.get('/api/summaries', async (_req: Request, res: Response) => {
    try {
      const summarizedEntries = getEntriesByState('summarized');
      const sentEntries = getEntriesByState('sent');
      const allEntries = [...summarizedEntries, ...sentEntries];
      const summaries = allEntries.map((entry: any) => ({
        id: entry.id,
        title: entry.title,
        feedName: entry.feedName,
        link: entry.link,
        whatHappened: entry.structuredSummary?.what_happened || '',
        whyItMatters: entry.structuredSummary?.why_it_matters || '',
        keyDetail: entry.structuredSummary?.key_detail || '',
        isArxiv: entry.feedName.startsWith(config.arxivFeedPrefix),
      }));
      res.json({ summaries });
    } catch (err) {
      log.error('Error fetching summaries', err);
      res.status(500).json({ error: 'Failed to fetch summaries' });
    }
  });

  return app;
}
