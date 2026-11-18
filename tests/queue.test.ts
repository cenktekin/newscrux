import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Article } from '../src/types.js';

type QueueModule = typeof import('../src/queue.js');

let dataDir: string;
let queue: QueueModule;

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: 'article-1',
    title: 'Article one',
    link: 'https://example.com/one',
    snippet: 'snippet',
    source: 'TechCrunch AI',
    feedKind: 'media',
    feedPriority: 'normal',
    publishedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'newscrux-queue-'));
  vi.stubEnv('DATA_DIR', dataDir);
  vi.resetModules();
  queue = await import('../src/queue.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('queue state machine', () => {
  it('discovers only unknown articles', () => {
    const count = queue.discoverArticles([
      article({ id: 'a' }),
      article({ id: 'b' }),
      article({ id: 'a' }),
    ]);

    expect(count).toBe(2);
    expect(queue.getEntriesByState('discovered').map(e => e.id)).toEqual(['a', 'b']);

    expect(queue.discoverArticles([article({ id: 'a' })])).toBe(0);
  });

  it('transitions an entry and refreshes its timestamp', () => {
    queue.discoverArticles([article({ id: 'a' })]);
    const before = queue.getQueue().entries['a'].lastUpdatedAt;

    queue.transitionEntry('a', 'enriched', { enrichedContent: 'full text' });

    const entry = queue.getQueue().entries['a'];
    expect(entry.state).toBe('enriched');
    expect(entry.enrichedContent).toBe('full text');
    expect(entry.lastUpdatedAt).toBeGreaterThanOrEqual(before);
  });

  it('retries a failed entry and marks it failed after three attempts', () => {
    queue.discoverArticles([article({ id: 'a' })]);

    queue.markFailed('a', 'first failure');
    expect(queue.getQueue().entries['a'].state).toBe('discovered');
    expect(queue.getQueue().entries['a'].retryCount).toBe(1);

    queue.markFailed('a', 'second failure');
    expect(queue.getQueue().entries['a'].state).toBe('discovered');

    queue.markFailed('a', 'third failure');
    const entry = queue.getQueue().entries['a'];
    expect(entry.state).toBe('failed');
    expect(entry.retryCount).toBe(3);
    expect(entry.lastError).toBe('third failure');
  });

  it('persists entries across a reload', () => {
    queue.discoverArticles([article({ id: 'a' })]);
    queue.transitionEntry('a', 'sent');
    queue.saveArticleQueue();

    vi.resetModules();
    return import('../src/queue.js').then(reloaded => {
      expect(reloaded.isKnown('a')).toBe(true);
      expect(reloaded.getQueue().entries['a'].state).toBe('sent');
    });
  });

  it('counts entries per state', () => {
    queue.discoverArticles([article({ id: 'a' }), article({ id: 'b' })]);
    queue.transitionEntry('b', 'sent');

    const counts = queue.countByState();
    expect(counts.discovered).toBe(1);
    expect(counts.sent).toBe(1);
    expect(counts.failed).toBe(0);
  });
});

describe('queue schema validation', () => {
  it('accepts a valid queue', () => {
    const valid = {
      entries: {
        a: {
          id: 'a',
          state: 'discovered',
          feedName: 'Feed',
          feedKind: 'media',
          feedPriority: 'normal',
          title: 'Title',
          link: 'https://example.com',
          snippet: '',
          discoveredAt: 1,
          lastUpdatedAt: 1,
        },
      },
      lastCleanup: 1,
      coldStartDone: true,
    };

    expect(queue.validateQueue(valid)).not.toBeNull();
  });

  it('rejects invalid shapes', () => {
    expect(queue.validateQueue(null)).toBeNull();
    expect(queue.validateQueue({ entries: [] })).toBeNull();
    expect(queue.validateQueue({ entries: {}, lastCleanup: 1 })).toBeNull();
    expect(queue.validateQueue({ entries: { a: { id: 'b', state: 'discovered', title: '', link: '', discoveredAt: 1, lastUpdatedAt: 1 } }, lastCleanup: 1, coldStartDone: false })).toBeNull();
    expect(queue.validateQueue({ entries: { a: { id: 'a', state: 'unknown', title: '', link: '', discoveredAt: 1, lastUpdatedAt: 1 } }, lastCleanup: 1, coldStartDone: false })).toBeNull();
  });

  it('quarantines a corrupt queue file instead of silently resetting it', () => {
    const queueFile = join(dataDir, 'article-queue.json');
    writeFileSync(queueFile, '{"entries": {"a": {"id": "a", "state": "bogus"}}}', 'utf-8');

    const loaded = queue.loadArticleQueue();

    expect(loaded.entries).toEqual({});
    const backups = readdirSync(dataDir).filter(name => name.startsWith('article-queue.json.corrupt-'));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(dataDir, backups[0]), 'utf-8')).toContain('bogus');
  });
});
