export type MetadataStatus = {
  status?: "fresh" | "stale" | "unavailable";
  error?: string | null;
  observedAt: number | null;
  lastChecked?: number;
  nextCheck?: number;
  complete: boolean;
  totalCount: number;
  source: string;
  sourceUrl?: string;
};
export type ModelMetadata = {
  id: string; name: string; provider: string;
  contextLength?: number | null;
  inputModalities?: string[]; outputModalities?: string[]; supportedParameters?: string[];
  pricing?: Record<string, string | null>;
  addedToOpenRouter?: number | null; firstSeen?: number;
  repositoryCreated?: string; repositoryUpdated?: string;
  sourceUrl?: string; releaseDateLabel: string;
  subtype?: string; baseModels?: string[]; license?: string | null;
};
export type ModelMetadataSnapshot = MetadataStatus & {
  models: ModelMetadata[];
  scope?: string;
  changes?: {kind: string; modelId: string; fields?: string[]; label: string}[];
  huggingFace?: ModelMetadataSnapshot;
};
export type BenchmarkRow = {
  model: string; benchmark: string; metric: string; unit: "rating" | "percent" | "fraction";
  value: number | null; confidenceLow?: number | null; confidenceHigh?: number | null;
  category?: string; publishedAt?: string | null; version?: string | null;
  votes?: number | null; rank?: number | null; modelLicense?: string | null;
  agent?: string | null; modelIdentity?: string | null;
  configuration?: string | string[] | null;
  checked?: boolean | null; sourceUrl?: string;
};
export type BenchmarkPanel = MetadataStatus & {
  license?: string; licenseUrl?: string; attribution?: string; modifications?: string;
  rows: BenchmarkRow[];
};
export type BenchmarkSnapshot = {panels: BenchmarkPanel[]; comparisonNote: string};

export type Preferences = {
  topics: string[];
  regions: string[];
  languages: string[];
  sources: string[];
  keywords: string[];
  excludeKeywords: string[];
  diversityCap: number;
};
export type FocusSection = "ai" | "technology" | "stocks" | "others";
export type SourceAccess = "free-keyless" | "approval-free" | "external-only";
export type SourceAdapter =
  | "feed"
  | "openrouter-models"
  | "hf-models"
  | "arena-results"
  | "swebench-results"
  | "bluesky-author"
  | "external-link";
export type Profile = {
  id: string;
  name: string;
  preferences: Preferences;
  quietHours: { enabled: boolean; start: string; end: string };
  alertsEnabled: boolean;
  lastVisit: number;
  previousVisit: number;
};
export type Source = {
  mediaAllowed?: boolean;
  id: string;
  name: string;
  url: string;
  homepage: string;
  kind: string;
  topics: string[];
  sectionScope?: FocusSection[];
  region: string;
  language: string;
  enabled: boolean;
  aiAllowed?: boolean;
  status: string;
  lastSuccess: number | null;
  lastAttempt?: number | null;
  retryAt?: number | null;
  failures?: number;
  refreshMinutes?: number;
  termsUrl: string;
  storage: string;
  accessMode?: SourceAccess;
  sourceAdapter?: SourceAdapter;
  publisher?: string;
  imagesAvailable?: boolean;
};
export type MediaRef = { kind: "image" | "video"; url: string; mimeType?: string; caption?: string; credit?: string; playback: "inline" | "external" };
export type MediaResult = { kind: "image" | "video"; mimeType: string; bytes: number; dataUrl: string };
export type Article = {
  media?: MediaRef[];
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  excerpt: string;
  publishedAt: number | null;
  firstSeen: number;
  updatedAt: number;
  topics: string[];
  sections?: FocusSection[];
  topicLabels?: string[];
  classificationVersion?: number;
  classificationReasons?: string[];
  region: string;
  language: string;
  kind: string;
  aiAllowed?: boolean;
  read: boolean;
  saved: boolean;
  hidden: boolean;
  groupId: string;
  reasons: string[];
  score: number;
  history: { at: number; title: string; excerpt: string }[];
};
export type Watchlist = {
  id: string;
  name: string;
  keywords: string[];
  topics: string[];
  sources: string[];
  alerts: boolean;
};
export type Tab = {
  id: string;
  title: string;
  topic: string;
  query: string;
  section?: FocusSection;
  mode: "all" | "saved" | "brief" | "watchlist" | "briefing" | "live" | "hidden";
  watchlistId?: string;
  selectedId?: string;
};
export type Workspace = { tabs: Tab[]; activeTabId: string; revision?: number };
export type Provider = {
  id: string;
  name: string;
  kind: "ollama" | "gemini" | "groq";
  model: string;
  enabled: boolean;
  consented: boolean;
  hasKey: boolean;
};
export type Snapshot = {
  replacementToken: string;
  profiles: Profile[];
  profile: Profile;
  sources: Source[];
  articles: Article[];
  watchlists: Watchlist[];
  workspace: Workspace;
  providers: Provider[];
  lastRefresh: number | null;
};
export type LiveItem = { id: string; title: string; url: string; discussionUrl: string; by: string; publishedAt: string | null; receivedAt: string; score: number };
export type LiveStatus = { enabled: boolean; state: "off" | "connecting" | "connected" | "backoff"; lastEventAt?: string | null; lastItemAt?: string | null; retryAt?: string | null; message?: string; items: LiveItem[] };
export type BriefItem = Pick<Article, "id" | "title" | "url" | "sourceId" | "sourceName" | "publishedAt" | "kind" | "excerpt" | "aiAllowed">;
export type DailyBrief = {
  date: string;
  dayStart: number;
  dayEnd: number;
  generatedAt: number;
  coverageLabel: string;
  articleCount: number;
  undatedCount: number;
  sectors: { id: string; title: string; articleCount: number; sourceCount: number; items: BriefItem[]; outline: string[] }[];
};
export type SectorSummarySource = {
  id: string;
  articleId: string;
  title: string;
  url: string;
  sourceName: string;
  publishedAt: number | null;
  inputLabel: string;
  attribution: string | null;
  outputLabel: string | null;
};
export type SectorSummaryPreview = {
  profileId: string;
  date: string;
  sectorId: string;
  sectorTitle: string;
  fingerprint: string;
  eligibleCount: number;
  excludedCount: number;
  selectedCount: number;
  limit: number;
  sources: SectorSummarySource[];
  coverageLabel: string;
};
export type SectorSummaryResult = {
  profileId: string;
  date: string;
  sectorId: string;
  fingerprint: string;
  provider: string;
  model: string;
  generatedAt: number;
  bullets: {
    text: string;
    citations: string[];
    // Optional only for legacy wire compatibility; missing evidence is not renderable.
    evidence?: { sourceId: string; quote: string }[];
  }[];
  sources: SectorSummarySource[];
  coverageLabel: string;
  warning: string;
};
export type Summary = {
  attribution?: string;
  outputLabel?: string;
  inputLabel?: string;
  text: string;
  provider: string;
  model: string;
  generatedAt: number;
  scope: string;
  url: string;
};
