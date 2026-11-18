// src/llm.ts — merkezi LLM gateway istemcisi (Karargah / shared/llm)
import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('llm');
const PROJECT = 'newscrux';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function extractContent(data: any): string {
  const choice = data?.choices?.[0];
  const choiceContent = choice?.message?.content;
  if (typeof choiceContent === 'string' && choiceContent.trim().length > 0) {
    return choiceContent.trim();
  }
  if (Array.isArray(choiceContent)) {
    const joined = choiceContent
      .filter((part: any) => typeof part?.text === 'string')
      .map((part: any) => String(part.text).trim())
      .filter(Boolean)
      .join('');
    if (joined.length > 0) return joined;
  }
  if (typeof choice?.text === 'string' && choice.text.trim().length > 0) {
    return choice.text.trim();
  }
  const reasoningContent = choice?.message?.reasoning_content;
  if (typeof reasoningContent === 'string' && reasoningContent.trim().length > 0) {
    return reasoningContent.trim();
  }
  return '';
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function callLlm(
  prompt: string,
  systemPrompt: string,
  options?: { maxTokens?: number },
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  const url = `${config.llmGatewayUrl}/v1/chat/completions?project=${PROJECT}`;

  for (let attempt = 0; attempt <= config.llmMaxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.llmTimeoutMs);

      const body: Record<string, unknown> = {
        messages,
        temperature: config.llmTemperature,
      };
      if (options?.maxTokens) body.max_tokens = options.maxTokens;

      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`LLM gateway error: ${response.status} ${response.statusText}`);
      }

      const rawBody = await response.text();
      let data: any;
      try {
        data = JSON.parse(rawBody);
      } catch {
        throw new Error(`Invalid JSON from gateway: ${rawBody.slice(0, 300)}`);
      }

      const content = extractContent(data);
      if (!content) {
        throw new Error(`Empty response from gateway: ${rawBody.slice(0, 300)}`);
      }

      log.debug(`LLM response received (${content.length} chars)`);
      return content;
    } catch (err) {
      if (attempt < config.llmMaxRetries) {
        const backoffMs = Math.pow(2, attempt + 1) * 1000;
        log.warn(`LLM attempt ${attempt + 1} failed, retrying in ${backoffMs}ms: ${err}`);
        await delay(backoffMs);
      } else {
        log.error('LLM failed after retries', err);
        throw err;
      }
    }
  }

  throw new Error('LLM failed after all retries');
}
