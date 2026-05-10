export interface StargazerEvent {
  username: string;
  starredAt: Date;
}

export interface DailyBucket {
  date: string;
  count: number;
  users: string[];
}

export interface Burst {
  startDate: string;
  endDate: string;
  days: number;
  stars: number;
  users: string[];
  median: number;
  mad: number;
  spikeRatio: number;
}

export interface CrossValidation {
  forkDelta: number;
  forkRatio: number;
  hasReferrerEvidence: boolean;
  topReferrers: string[];
  verdict: 'organic' | 'suspicious' | 'fake';
  confidence: number;
}

export interface ForkPoint {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface ReferrerSnapshot {
  referrer: string;
  count: number;
  uniques: number;
}

/**
 * Result of per-user account scoring on a sample of burst stargazers.
 * Attached to a burst when we ran user-level analysis on it.
 */
export interface UserScoreSummary {
  /** How many stargazers we sampled and scored from the burst */
  sampled: number;
  /** How many of the sample crossed the suspicion threshold */
  suspicious: number;
  /** Fraction of sample flagged (0..1) */
  suspiciousRatio: number;
  /** Top suspicious accounts (login + reasons), capped at ~10 for the tooltip */
  examples: Array<{ login: string; score: number; reasons: string[] }>;
}

export interface AnalysisResult {
  owner: string;
  repo: string;
  totalStars: number;
  analyzedStars: number;
  bursts: Burst[];
  validatedBursts: Array<Burst & { validation: CrossValidation; userAnalysis?: UserScoreSummary }>;
  suspiciousStars: number;
  realStars: number;
  fakePercent: number;
  riskLevel: 'low' | 'medium' | 'high';
  /**
   * When true, the algorithm has too little signal to give a confident
   * verdict (e.g. repo is below MIN_STARS_FOR_VERDICT) AND no StarScout
   * verdict was found. The badge should show an "insufficient data" state
   * and ignore the burst/risk fields.
   */
  insufficientData?: boolean;
  analyzedAt: number;
  warning?: string;
}

export interface CachedAnalysis extends AnalysisResult {
  cachedAt: number;
  ttlMs: number;
  /**
   * Cache schema version (CACHE_SCHEMA_VERSION at write time). Read paths
   * MUST treat entries with a mismatched version as stale, even if they're
   * still inside the TTL — older entries may have fields computed under a
   * pre-fix algorithm.
   */
  schemaVersion: number;
}

export type AuthState =
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; token: string; login?: string; scopes?: string[] };

export interface RuntimeMessage {
  type: 'analyze-repo' | 'get-auth-state' | 'sign-in' | 'logout' | 'clear-cache';
  payload?: unknown;
}

export interface AnalyzeRepoMessage extends RuntimeMessage {
  type: 'analyze-repo';
  payload: { owner: string; repo: string; forceRefresh?: boolean };
}
