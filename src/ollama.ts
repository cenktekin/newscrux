// src/ollama.ts
import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('ollama');

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  think?: boolean;
  reasoning?: boolean;
}

interface ChatChoice {
  message: {
    content?: string | Array<{ type?: string; text?: string }>;
    reasoning_content?: string;
  };
  text?: string;
}

interface ChatResponse {
  choices?: ChatChoice[];
  message?: { content?: string };
  response?: string;
}

function extractContent(data: ChatResponse): string {
  const choice = data.choices?.[0];
  const choiceContent = choice?.message?.content;
  if (typeof choiceContent === 'string' && choiceContent.trim().length > 0) {
    return choiceContent.trim();
  }
  if (Array.isArray(choiceContent)) {
    const joined = choiceContent
      .filter((part): part is { type?: string; text?: string } => typeof part?.text === 'string')
      .map(part => part.text!.trim())
      .filter(Boolean)
      .join('');
    if (joined.length > 0) return joined;
  }
  if (typeof choice?.text === 'string' && choice.text.trim().length > 0) {
    return choice.text.trim();
  }
  if (typeof data.message?.content === 'string' && data.message.content.trim().length > 0) {
    return data.message.content.trim();
  }
  if (typeof data.response === 'string' && data.response.trim().length > 0) {
    return data.response.trim();
  }
  const reasoningContent = choice?.message?.reasoning_content as string | undefined;
  const reasoning = (choice?.message as Record<string, unknown>)?.reasoning;
  if (typeof reasoningContent === 'string' && reasoningContent.trim().length > 0) {
    return reasoningContent.trim();
  }
  if (typeof reasoning === 'string' && reasoning.trim().length > 0) {
    return reasoning.trim();
  }
  return '';
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function callOllama(
  prompt: string,
  systemPrompt: string,
  options?: { maxTokens?: number },
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  for (let attempt = 0; attempt <= config.ollamaMaxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.ollamaTimeoutMs);
      const request: ChatRequest = {
        model: config.ollamaModel,
        messages,
        temperature: config.ollamaTemperature,
        stream: false,
      };
      if (options?.maxTokens) {
        request.max_tokens = options.maxTokens;
      }

      const response = await fetch(`${config.ollamaBaseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const rawBody = await response.text();
      let data: ChatResponse;
      try {
        data = JSON.parse(rawBody) as ChatResponse;
      } catch {
        throw new Error(`Invalid JSON from Ollama: ${rawBody.slice(0, 300)}`);
      }

      const content = extractContent(data);

      if (!content) {
        throw new Error(`Empty response from Ollama: ${rawBody.slice(0, 300)}`);
      }

      log.debug(`Ollama response received (${content.length} chars)`);
      return content;
    } catch (err) {
      if (attempt < config.ollamaMaxRetries) {
        const backoffMs = Math.pow(2, attempt + 1) * 1000;
        log.warn(`Ollama attempt ${attempt + 1} failed, retrying in ${backoffMs}ms: ${err}`);
        await delay(backoffMs);
      } else {
        log.error('Ollama failed after retries', err);
        throw err;
      }
    }
  }

  throw new Error('Ollama failed after all retries');
}
