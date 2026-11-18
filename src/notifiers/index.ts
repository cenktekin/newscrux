// src/notifiers/index.ts
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import type { Notifier } from './types.js';
import { createPushoverNotifier } from './pushover.js';
import { createTelegramNotifier } from './telegram.js';
import { createDiscordNotifier } from './discord.js';

const log = createLogger('notifier');

export type { Notifier } from './types.js';

const KNOWN_CHANNELS = ['pushover', 'telegram', 'discord'] as const;

/** Builds the notifier list from `NOTIFY_CHANNELS` on every call. */
export function getNotifiers(): Notifier[] {
  const notifiers: Notifier[] = [];

  for (const channel of config.notifyChannels) {
    switch (channel) {
      case 'pushover':
        notifiers.push(
          createPushoverNotifier({
            appToken: config.pushoverAppToken,
            userKey: config.pushoverUserKey,
          }),
        );
        break;
      case 'telegram':
        notifiers.push(
          createTelegramNotifier({
            botToken: config.telegramBotToken,
            chatId: config.telegramChatId,
          }),
        );
        break;
      case 'discord':
        notifiers.push(createDiscordNotifier({ webhookUrl: config.discordWebhookUrl }));
        break;
      default:
        log.warn(`Unknown notification channel "${channel}" — ignored`);
    }
  }

  return notifiers;
}

/**
 * Reports configuration problems for the selected channels.
 * Empty array means the notifier set is usable.
 */
export function validateNotifierConfig(): string[] {
  const problems: string[] = [];

  if (config.notifyChannels.length === 0) {
    problems.push('NOTIFY_CHANNELS is empty — set at least one of: pushover, telegram, discord.');
    return problems;
  }

  for (const channel of config.notifyChannels) {
    switch (channel) {
      case 'pushover':
        if (!config.pushoverUserKey || !config.pushoverAppToken) {
          problems.push('PUSHOVER_USER_KEY and PUSHOVER_APP_TOKEN are required for the pushover channel.');
        }
        break;
      case 'telegram':
        if (!config.telegramBotToken || !config.telegramChatId) {
          problems.push('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required for the telegram channel.');
        }
        break;
      case 'discord':
        if (!config.discordWebhookUrl) {
          problems.push('DISCORD_WEBHOOK_URL is required for the discord channel.');
        }
        break;
      default:
        problems.push(`Unknown notification channel "${channel}" (known: ${KNOWN_CHANNELS.join(', ')}).`);
    }
  }

  return problems;
}

/**
 * Fans a notification out to every configured channel.
 * Resolves true when at least one channel accepted the message.
 */
export async function sendToAllNotifiers(
  title: string,
  message: string,
  url?: string,
  urlTitle?: string,
): Promise<boolean> {
  const notifiers = getNotifiers();
  if (notifiers.length === 0) {
    log.warn('No notification channels configured — message dropped');
    return false;
  }

  const results = await Promise.all(
    notifiers.map(async notifier => {
      const ok = await notifier.send(title, message, url, urlTitle);
      if (!ok) log.warn(`Channel "${notifier.name}" rejected the notification`);
      return ok;
    }),
  );

  return results.some(Boolean);
}
