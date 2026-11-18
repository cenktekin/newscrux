// src/relevance.ts
import { config } from './config.js';
import { createLogger } from './logger.js';
import { callLlm } from './llm.js';
import type { QueueEntry } from './types.js';

const log = createLogger('relevance');

const RELEVANCE_PROMPT = `You are an AI/ML news filter. Score each article's relevance to AI/ML topics (LLMs, GPT, deep learning, NLP, computer vision, robotics, AI hardware, etc). General tech, climate, politics get low scores.

Output ONLY a JSON array with no other text. Example:
[{"id":0,"score":8},{"id":1,"score":3}]

Score 1-10 where 1=not AI-related, 10=highly AI-related. Only output the JSON array.`;

const RELEVANCE_KEYWORDS = [
  'ai', 'artificial intelligence', 'machine learning', 'ml', 'deep learning', 'llm', 'gpt', 'transformer',
  'nlp', 'computer vision', 'robotics', 'speech model', 'neural', 'inference', 'fine-tuning',
  'openai', 'deepmind', 'anthropic', 'gemini', 'mistral', 'arxiv', 'gpu', 'npu', 'cuda',
];
const NEGATIVE_KEYWORDS = [
  'climate', 'weather', 'sports', 'celebrity', 'politics', 'election', 'war', 'movie', 'music', 'recipe',
];

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface RelevanceResult {
  passed: QueueEntry[];
  dropped: Array<{ entry: QueueEntry; score: number }>;
  bypassed: QueueEntry[];
  parseError: boolean;
}

function keywordScore(entry: QueueEntry): number {
  const text = `${entry.title} ${entry.snippet}`.toLowerCase();
  let score = 1;
  for (const keyword of RELEVANCE_KEYWORDS) {
    if (text.includes(keyword)) score += 1;
  }
  for (const keyword of NEGATIVE_KEYWORDS) {
    if (text.includes(keyword)) score -= 1;
  }
  return Math.max(1, Math.min(10, score));
}

function buildKeywordFallbackResult(toScore: QueueEntry[], bypassed: QueueEntry[]): RelevanceResult {
  const threshold = config.relevanceThreshold;
  const passed: QueueEntry[] = [];
  const dropped: Array<{ entry: QueueEntry; score: number }> = [];

  for (const entry of toScore) {
    const score = keywordScore(entry);
    if (score >= threshold) {
      passed.push(entry);
    } else {
      dropped.push({ entry, score });
    }
  }

  log.warn(
    `Relevance fallback keyword mode: passed=${passed.length}/${toScore.length}, dropped=${dropped.length}, threshold=${threshold}`
  );

  return { passed, dropped, bypassed, parseError: true };
}

export async function filterByRelevance(entries: QueueEntry[]): Promise<RelevanceResult> {
  const bypassed: QueueEntry[] = [];
  const toScore: QueueEntry[] = [];

  for (const entry of entries) {
    if (entry.feedPriority === 'high') {
      bypassed.push(entry);
    } else {
      toScore.push(entry);
    }
  }

  if (bypassed.length > 0) {
    log.info(`Relevance bypass: ${bypassed.length} high-priority entries`);
  }

  if (toScore.length === 0) {
    return { passed: [], dropped: [], bypassed, parseError: false };
  }

  const list = toScore
    .map((e, i) => `${i}. [${e.feedName}] ${e.title}\n   ${e.snippet.trim()}`)
    .join('\n');

  let text: string;

  try {
    text = await callLlm(list, RELEVANCE_PROMPT, {
      maxTokens: config.llmRelevanceMaxTokens,
    });
  } catch (err) {
    log.error('Relevance check failed after retries — entries stay discovered for retry', err);
    return { passed: [], dropped: [], bypassed, parseError: true };
  }

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    log.warn('No JSON array found in relevance response');
    return buildKeywordFallbackResult(toScore, bypassed);
  }

  let parsed: Array<{ id: number; score: number }>;
  try {
    parsed = JSON.parse(jsonMatch[0]) as Array<{ id: number; score: number }>;
  } catch (err) {
    log.warn(`Invalid relevance JSON, using keyword fallback: ${err}`);
    return buildKeywordFallbackResult(toScore, bypassed);
  }
  const scores = new Map<number, number>();
  for (const entry of parsed) {
    if (typeof entry.id === 'number' && typeof entry.score === 'number') {
      scores.set(entry.id, entry.score);
    }
  }

  const threshold = config.relevanceThreshold;
  const passed: QueueEntry[] = [];
  const dropped: Array<{ entry: QueueEntry; score: number }> = [];

  for (let i = 0; i < toScore.length; i++) {
    const score = scores.get(i);
    if (score === undefined) {
      passed.push(toScore[i]);
    } else if (score >= threshold) {
      passed.push(toScore[i]);
    } else {
      dropped.push({ entry: toScore[i], score });
    }
  }

  if (dropped.length > 0) {
    log.info(
      `Relevance dropped ${dropped.length}: ${dropped.map(d => `"${d.entry.title}" (${d.score}/${threshold})`).join(', ')}`
    );
  }
  log.info(`Relevance: ${passed.length}/${toScore.length} passed (threshold ${threshold})`);

  return { passed, dropped, bypassed, parseError: false };
}
