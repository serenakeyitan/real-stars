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
  analyzedAt: number;
  warning?: string;
}

export interface CachedAnalysis extends AnalysisResult {
  cachedAt: number;
  ttlMs: number;
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
