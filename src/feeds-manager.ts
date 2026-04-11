// src/feeds-manager.ts
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from './logger.js';
import type { FeedConfig } from './types.js';

const log = createLogger('feeds-manager');

const FEEDS_FILE = resolve(process.cwd(), 'feeds.json');

interface FeedsStore {
  feeds: FeedConfig[];
  lastUpdated: number;
}

function loadFeedsStore(): FeedsStore {
  try {
    const data = readFileSync(FEEDS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    const store: FeedsStore = { feeds: [], lastUpdated: Date.now() };
    saveFeedsStore(store);
    return store;
  }
}

function saveFeedsStore(store: FeedsStore): void {
  const tmpFile = FEEDS_FILE + '.tmp';
  writeFileSync(tmpFile, JSON.stringify(store, null, 2), 'utf-8');
  renameSync(tmpFile, FEEDS_FILE);
}

export function getFeeds(): FeedConfig[] {
  const store = loadFeedsStore();
  return store.feeds;
}

export function addFeed(feed: Omit<FeedConfig, 'id'>): FeedConfig {
  const store = loadFeedsStore();
  const newFeed: FeedConfig = { ...feed, id: uuidv4() };
  store.feeds.push(newFeed);
  store.lastUpdated = Date.now();
  saveFeedsStore(store);
  log.info(`Feed added: ${newFeed.name}`);
  return newFeed;
}

export function updateFeed(id: string, updates: Partial<Omit<FeedConfig, 'id'>>): FeedConfig | null {
  const store = loadFeedsStore();
  const index = store.feeds.findIndex(f => f.id === id);
  if (index === -1) {
    return null;
  }
  store.feeds[index] = { ...store.feeds[index], ...updates };
  store.lastUpdated = Date.now();
  saveFeedsStore(store);
  log.info(`Feed updated: ${id}`);
  return store.feeds[index];
}

export function deleteFeed(id: string): boolean {
  const store = loadFeedsStore();
  const index = store.feeds.findIndex(f => f.id === id);
  if (index === -1) {
    return false;
  }
  const removed = store.feeds.splice(index, 1)[0];
  store.lastUpdated = Date.now();
  saveFeedsStore(store);
  log.info(`Feed deleted: ${removed.name}`);
  return true;
}

export function initializeFromConfig(feeds: FeedConfig[]): void {
  const store = loadFeedsStore();
  if (store.feeds.length > 0) {
    return;
  }
  const feedsWithIds = feeds.map(f => ({ ...f, id: uuidv4() }));
  store.feeds = feedsWithIds;
  store.lastUpdated = Date.now();
  saveFeedsStore(store);
  log.info(`Initialized ${feedsWithIds.length} feeds from config`);
}
