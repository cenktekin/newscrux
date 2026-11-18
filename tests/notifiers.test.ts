import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiscordNotifier } from '../src/notifiers/discord.js';
import { createPushoverNotifier } from '../src/notifiers/pushover.js';
import { TELEGRAM_MAX_MESSAGE, createTelegramNotifier } from '../src/notifiers/telegram.js';

function mockFetch(response: { ok: boolean; status?: number; body?: string } = { ok: true }) {
  const fn = vi.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    text: async () => response.body ?? '',
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function parseBody(fn: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fn.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('telegram notifier', () => {
  it('posts HTML-formatted text with chat_id and token to the Bot API', async () => {
    const fetchMock = mockFetch();
    const notifier = createTelegramNotifier({ botToken: 'bot-token', chatId: '42' });

    const ok = await notifier.send(
      'A & B',
      '\n\n<b>What happened</b> Body text',
      'https://example.com/a',
      'Read more',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botbot-token/sendMessage');

    const body = parseBody(fetchMock);
    expect(body.chat_id).toBe('42');
    expect(body.parse_mode).toBe('HTML');
    expect(body.text).toContain('A &amp; B');
    expect(body.text).toContain('href="https://example.com/a"');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(ok).toBe(true);
  });

  it('truncates the payload to the Telegram 4096 character limit', async () => {
    const fetchMock = mockFetch();
    const notifier = createTelegramNotifier({ botToken: 'bot-token', chatId: '42' });

    await notifier.send('Title', 'x'.repeat(6000));

    const body = parseBody(fetchMock);
    expect((body.text as string).length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE);
  });

  it('returns false when the Bot API rejects the message', async () => {
    mockFetch({ ok: false, status: 400, body: 'bad request' });
    const notifier = createTelegramNotifier({ botToken: 'bot-token', chatId: '42' });

    await expect(notifier.send('Title', 'Body')).resolves.toBe(false);
  });
});

describe('discord notifier', () => {
  it('converts HTML to markdown and posts to the webhook', async () => {
    const fetchMock = mockFetch();
    const notifier = createDiscordNotifier({ webhookUrl: 'https://discord.test/hook' });

    const ok = await notifier.send('Title', '\n\n<b>What happened</b> A &amp; B');

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://discord.test/hook');

    const body = parseBody(fetchMock);
    expect(body.content).toContain('**Title**');
    expect(body.content).toContain('**What happened**');
    expect(body.content).toContain('A & B');
    expect(body.content).not.toContain('<b>');
    expect(ok).toBe(true);
  });

  it('caps content at the Discord 2000 character limit', async () => {
    const fetchMock = mockFetch();
    const notifier = createDiscordNotifier({ webhookUrl: 'https://discord.test/hook' });

    await notifier.send('Title', 'y'.repeat(5000), 'https://example.com/a');

    const body = parseBody(fetchMock);
    expect((body.content as string).length).toBeLessThanOrEqual(2000);
  });
});

describe('pushover notifier', () => {
  it('keeps the existing form-encoded Pushover payload', async () => {
    const fetchMock = mockFetch();
    const notifier = createPushoverNotifier({ appToken: 'app', userKey: 'user' });

    const ok = await notifier.send('Title', '<b>Body</b>', 'https://example.com/a', 'Read more');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.pushover.net/1/messages.json');
    expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });

    const params = init.body as URLSearchParams;
    expect(params.get('token')).toBe('app');
    expect(params.get('user')).toBe('user');
    expect(params.get('html')).toBe('1');
    expect(params.get('title')).toBe('Title');
    expect(params.get('message')).toBe('<b>Body</b>');
    expect(params.get('url')).toBe('https://example.com/a');
    expect(params.get('url_title')).toBe('Read more');
    expect(ok).toBe(true);
  });
});
