import { describe, expect, it } from 'vitest';
import { deduplicateArticles } from '../src/dedup.js';
import type { Article } from '../src/types.js';

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: 'article-1',
    title: 'OpenAI releases new agent toolkit',
    link: 'https://example.com/a',
    snippet: '',
    source: 'TechCrunch AI',
    feedKind: 'media',
    feedPriority: 'normal',
    publishedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('deduplicateArticles', () => {
  it('returns an empty list unchanged', () => {
    expect(deduplicateArticles([])).toEqual([]);
  });

  it('keeps unrelated articles', () => {
    const articles = [
      article({ id: 'a', title: 'OpenAI releases new agent toolkit' }),
      article({ id: 'b', title: 'Quantum computing startup raises series B' }),
    ];

    expect(deduplicateArticles(articles).map(a => a.id)).toEqual(['a', 'b']);
  });

  it('removes cross-source near duplicates and keeps the longer snippet', () => {
    const articles = [
      article({ id: 'short', title: 'OpenAI releases new agent toolkit', snippet: 'short', source: 'TechCrunch AI' }),
      article({ id: 'long', title: 'OpenAI releases the new agent toolkit', snippet: 'much longer snippet', source: 'The Verge AI' }),
    ];

    const result = deduplicateArticles(articles);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('long');
  });

  it('ignores stop words and punctuation when comparing titles', () => {
    const articles = [
      article({ id: 'a', title: 'The rise of AI agents in enterprise', snippet: 'x' }),
      article({ id: 'b', title: 'Rise of AI agents, in enterprise!', snippet: 'x' }),
    ];

    expect(deduplicateArticles(articles)).toHaveLength(1);
  });
});
