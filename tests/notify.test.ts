import { describe, expect, it } from 'vitest';
import { escapeHtml, renderNotification } from '../src/pushover.js';
import type { QueueEntry, StructuredSummary } from '../src/types.js';

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: 'entry-1',
    state: 'summarized',
    feedName: 'TechCrunch AI',
    feedKind: 'media',
    feedPriority: 'normal',
    title: 'Original title',
    link: 'https://example.com/article',
    snippet: '',
    discoveredAt: 1,
    lastUpdatedAt: 1,
    ...overrides,
  };
}

function summary(overrides: Partial<StructuredSummary> = {}): StructuredSummary {
  return {
    translated_title: 'Translated title',
    what_happened: 'Something happened.',
    why_it_matters: 'It matters because of reasons.',
    key_detail: 'A key detail.',
    source_type: 'media_report',
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml(`<b>"A" & 'B'</b>`)).toBe('&lt;b&gt;&quot;A&quot; &amp; &#039;B&#039;&lt;/b&gt;');
  });
});

describe('renderNotification', () => {
  it('renders an untruncated message for short summaries', () => {
    const result = renderNotification(entry(), summary());

    expect(result.truncated).toBe(false);
    expect(result.title).toBe('Translated title');
    expect(result.message).toContain('Something happened.');
    expect(result.message).toContain('It matters because of reasons.');
    expect(result.message).toContain('A key detail.');
  });

  it('falls back to the entry title when the summary has no translated title', () => {
    const result = renderNotification(entry(), summary({ translated_title: '' }));

    expect(result.title).toBe('Original title');
  });

  it('truncates long summaries to the 1024 character limit', () => {
    const longText = 'Long sentence about AI. '.repeat(200);
    const result = renderNotification(
      entry(),
      summary({ what_happened: longText, why_it_matters: longText }),
    );

    expect(result.truncated).toBe(true);
    expect(result.message.length).toBeLessThanOrEqual(1024);
  });

  it('caps the title at 250 characters', () => {
    const result = renderNotification(entry(), summary({ translated_title: 'T'.repeat(400) }));

    expect(result.title).toHaveLength(250);
  });
});
