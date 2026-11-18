// src/metrics-store.ts
import type { PollMetrics } from './types.js';

export interface MetricsSnapshot {
  cycle: number;
  metrics: PollMetrics;
  updatedAt: number;
}

let latest: MetricsSnapshot | null = null;

export function recordMetrics(cycle: number, metrics: PollMetrics): void {
  latest = { cycle, metrics: { ...metrics }, updatedAt: Date.now() };
}

export function getLatestMetrics(): MetricsSnapshot | null {
  return latest;
}
