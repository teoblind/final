/**
 * Data layer types — shared interfaces for connectors, caching, and data fetching.
 */

export interface DataResult<T = any> {
  data: T;
  fetchedAt: string;
  stale: boolean;
  cached: boolean;
  source: string;
}

export interface DataConnector {
  id: string;
  name: string;
  fetch(params?: Record<string, any>): Promise<DataResult>;
  healthCheck(): Promise<boolean>;
  refreshInterval: number;
}

export interface CacheEntry<T = any> {
  data: T;
  fetchedAt: number;
  expiresAt: number;
}

export interface ConnectorStatus {
  id: string;
  name: string;
  healthy: boolean;
  lastCheck: number | null;
  lastError?: string;
}
