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
 * StarScout lookup hit. Set when the repo is in the published 250101
 * dataset of fake-star-flagged repos. When this is present, it overrides
 * the heuristic burst-detection result — StarScout is peer-reviewed
 * ground truth, ours is a heuristic.
 */
export interface StarScoutVerdict {
  source: 'starscout';
  totalStarsAtSnapshot: number;
  fakeStars: number;
  fakeRatio: number; // 0..1
  detectedBy: Array<'low-activity' | 'lockstep'>;
  snapshot: string; // ISO date
}

export interface AnalysisResult {
  owner: string;
  repo: string;
  totalStars: number;
  analyzedStars: number;
  bursts: Burst[];
  validatedBursts: Array<Burst & { validation: CrossValidation }>;
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
  /**
   * Set if the repo appears in StarScout's published dataset. This is
   * peer-reviewed ground truth — overrides the heuristic verdict.
   * Display layer should prefer this over fakePercent etc when set.
   */
  starscout?: StarScoutVerdict;
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
