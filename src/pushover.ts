// src/pushover.ts
import { config, runtimeConfig } from './config.js';
import { getLanguagePack } from './i18n.js';
import { escapeHtml } from './notifiers/html.js';
import { sendToAllNotifiers } from './notifiers/index.js';
import type { QueueEntry, StructuredSummary } from './types.js';

export { escapeHtml } from './notifiers/html.js';

// --- Smart Truncation ---

function trimToSentenceBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const truncated = text.slice(0, maxLength);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('.\n'),
    truncated.lastIndexOf('! '),
    truncated.lastIndexOf('!\n'),
    truncated.lastIndexOf('? '),
    truncated.lastIndexOf('?\n'),
  );

  if (lastSentenceEnd > maxLength * 0.3) {
    return truncated.slice(0, lastSentenceEnd + 1);
  }

  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 0 ? truncated.slice(0, lastSpace) + '...' : truncated;
}

// --- Notification Rendering ---

interface RenderResult {
  title: string;
  message: string;
  truncated: boolean;
}

export function renderNotification(entry: QueueEntry, summary: StructuredSummary): RenderResult {
  const isArxiv = entry.feedName.startsWith(config.arxivFeedPrefix);
  const emoji = isArxiv ? '📄' : '📰';
  const { labels } = getLanguagePack(runtimeConfig.language);

  // Support both translated_title and legacy title_tr
  // Title is NOT HTML-escaped — Pushover does not parse HTML in titles
  const titleRaw = summary.translated_title || (summary as any).title_tr || entry.title;
  const title = titleRaw.slice(0, 250);

  const source = escapeHtml(entry.feedName);
  const whatHappened = escapeHtml(summary.what_happened);
  const whyItMatters = escapeHtml(summary.why_it_matters);
  const keyDetail = escapeHtml(summary.key_detail);

  const sourceLine = `${emoji} ${source}`;
  const whatLine = `\n\n<b>${labels.whatHappened}</b> ${whatHappened}`;
  const whyLine = `\n\n<b>${labels.whyItMatters}</b> ${whyItMatters}`;
  const detailLine = `\n\n💡 ${keyDetail}`;

  const MAX_MESSAGE = 1024;

  let message = sourceLine + whatLine + whyLine + detailLine;
  if (message.length <= MAX_MESSAGE) {
    return { title, message, truncated: false };
  }

  message = sourceLine + whatLine + whyLine;
  if (message.length <= MAX_MESSAGE) {
    return { title, message, truncated: true };
  }

  const whyFirstSentence = whyItMatters.split(/[.!?]\s/)[0] + '.';
  const whyLineShort = `\n\n<b>${labels.whyItMatters}</b> ${whyFirstSentence}`;
  message = sourceLine + whatLine + whyLineShort;
  if (message.length <= MAX_MESSAGE) {
    return { title, message, truncated: true };
  }

  const availableForWhat = MAX_MESSAGE - (sourceLine + `\n\n<b>${labels.whatHappened}</b> ` + whyLineShort).length;
  const whatTrimmed = trimToSentenceBoundary(whatHappened, Math.max(availableForWhat, 100));
  message = sourceLine + `\n\n<b>${labels.whatHappened}</b> ${whatTrimmed}` + whyLineShort;

  return { title, message: message.slice(0, MAX_MESSAGE), truncated: true };
}

// --- Delivery ---

export async function sendArticleNotification(
  entry: QueueEntry,
  summary: StructuredSummary,
): Promise<{ success: boolean; truncated: boolean }> {
  const { title, message, truncated } = renderNotification(entry, summary);
  const isArxiv = entry.feedName.startsWith(config.arxivFeedPrefix);
  const { labels } = getLanguagePack(runtimeConfig.language);
  const urlTitle = isArxiv ? labels.readArticle : labels.readMore;

  const success = await sendToAllNotifiers(title, message, entry.link, urlTitle);
  return { success, truncated };
}
