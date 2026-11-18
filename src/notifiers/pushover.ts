// src/notifiers/pushover.ts
import { createLogger } from '../logger.js';
import type { Notifier } from './types.js';

const log = createLogger('notifier:pushover');

export const PUSHOVER_MAX_MESSAGE = 1024;

export interface PushoverCredentials {
  appToken: string;
  userKey: string;
}

export function createPushoverNotifier(credentials: PushoverCredentials): Notifier {
  return {
    name: 'pushover',
    async send(title, message, url, urlTitle) {
      try {
        const params: Record<string, string> = {
          token: credentials.appToken,
          user: credentials.userKey,
          title: title.slice(0, 250),
          message: message.slice(0, PUSHOVER_MAX_MESSAGE),
          html: '1',
        };

        if (url) params.url = url;
        if (urlTitle) params.url_title = urlTitle;

        const response = await fetch('https://api.pushover.net/1/messages.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(params),
        });

        if (!response.ok) {
          const body = await response.text();
          log.error(`Pushover error (${response.status}): ${body}`);
          return false;
        }

        return true;
      } catch (err) {
        log.error('Failed to send Pushover notification', err);
        return false;
      }
    },
  };
}
