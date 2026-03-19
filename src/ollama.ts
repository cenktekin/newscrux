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
}

interface ChatChoice {
  message: {
    content: string;
  };
}

interface ChatResponse {
  choices: ChatChoice[];
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const MAX_RETRIES = 2;

export async function callOllama(prompt: string, systemPrompt: string): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const request: ChatRequest = {
        model: config.ollamaModel,
        messages,
      };

      const response = await fetch(`${config.ollamaBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data: ChatResponse = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      if (!content) {
        throw new Error('Empty response from Ollama');
      }

      log.debug(`Ollama response received (${content.length} chars)`);
      return content;
    } catch (err) {
      if (attempt < MAX_RETRIES) {
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
