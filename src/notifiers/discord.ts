// src/notifiers/discord.ts
import { createLogger } from '../logger.js';
import type { Notifier } from './types.js';

const log = createLogger('notifier:discord');

export const DISCORD_MAX_CONTENT = 2000;

export interface DiscordOptions {
  webhookUrl: string;
}

/** Converts Pushover-style HTML to Discord-flavoured markdown. */
export function toDiscordMarkdown(html: string): string {
  return html
    .replace(/<b>/gi, '**')
    .replace(/<\/b>/gi, '**')
    .replace(/<i>/gi, '*')
    .replace(/<\/i>/gi, '*')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function createDiscordNotifier(options: DiscordOptions): Notifier {
  return {
    name: 'discord',
    async send(title, message, url) {
      try {
        const parts = [`**${title}**`, toDiscordMarkdown(message)];
        if (url) parts.push(url);

        // Discord hard-caps every message at 2000 characters.
        const content = parts.join('\n\n').slice(0, DISCORD_MAX_CONTENT);

        const response = await fetch(options.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });

        if (!response.ok) {
          const bodyText = await response.text();
          log.error(`Discord error (${response.status}): ${bodyText}`);
          return false;
        }

        return true;
      } catch (err) {
        log.error('Failed to send Discord notification', err);
        return false;
      }
    },
  };
}
