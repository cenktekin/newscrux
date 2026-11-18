// src/notifiers/telegram.ts
import { escapeHtml } from './html.js';
import { createLogger } from '../logger.js';
import type { Notifier } from './types.js';

const log = createLogger('notifier:telegram');

export const TELEGRAM_MAX_MESSAGE = 4096;

export interface TelegramOptions {
  botToken: string;
  chatId: string;
}

export function createTelegramNotifier(options: TelegramOptions): Notifier {
  return {
    name: 'telegram',
    async send(title, message, url, urlTitle) {
      try {
        // Telegram has no title field and parses HTML, so the (unescaped)
        // Pushover title is escaped here while the message body is already HTML.
        const header = `<b>${escapeHtml(title)}</b>`;
        const link = url
          ? `\n\n<a href="${escapeHtml(url)}">${escapeHtml(urlTitle || url)}</a>`
          : '';

        const budget = TELEGRAM_MAX_MESSAGE - header.length - link.length - 2;
        const body = message.length > budget ? message.slice(0, Math.max(budget, 0)) : message;
        const text = `${header}\n\n${body}${link}`.slice(0, TELEGRAM_MAX_MESSAGE);

        const response = await fetch(
          `https://api.telegram.org/bot${options.botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: options.chatId,
              text,
              parse_mode: 'HTML',
              disable_web_page_preview: false,
            }),
          },
        );

        if (!response.ok) {
          const bodyText = await response.text();
          log.error(`Telegram error (${response.status}): ${bodyText}`);
          return false;
        }

        return true;
      } catch (err) {
        log.error('Failed to send Telegram notification', err);
        return false;
      }
    },
  };
}
