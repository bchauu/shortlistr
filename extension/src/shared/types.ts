export type ShortlistrProfile = {
  lookingFor: string;
  strengths: string;
  workHighlights: string;
  mustHaves: string;
  niceToHaves: string;
  avoid: string;
};

export type ShortlistrSettings = {
  autoShortlistThreshold: number;
  promptShortlistThreshold: number;
  autoSaveNearCertain: boolean;
  autoSaveGreatFit: boolean;
  autoSavePossibleFit: boolean;
};

export type ShortlistrBackendConfig = {
  enabled: boolean;
  apiBaseUrl: string;
  apiToken: string;
  model: string;
};

export type ShortlistrQuota = {
  day: string;
  used: number;
  limit: number;
  remaining: number;
  resetAt?: string;
  firstAt?: string;
  lastAt?: string;
};

export type JobPayload = {
  source?: string;
  url?: string;
  title?: string;
  company?: string;
  location?: string;
  description?: string;
  descriptionCandidates?: Array<{
    id?: string;
    label?: string;
    source?: string;
    selector?: string;
    text?: string;
  }>;
};

export type JobAnalysis = {
  score: number;
  label?: string;
  summary: string;
  tldr?: string;
  resume_or_cover_letter_tip?: string;
  strengths_to_highlight: string[];
  reasons: string[];
  concerns: string[];
  action?: "auto_shortlist" | "prompt_shortlist" | "skip";
  saved_via?: "auto" | "manual";
  subscores?: {
    role_intent_match?: number;
    responsibilities_match?: number;
    environment_match?: number;
    preference_match?: number;
    seniority_match?: number;
    confidence?: number;
  };
  personas?: Array<{
    persona: string;
    label?: string;
    adjustedScore: number;
    delta: number;
    notes?: string[];
  }>;
  implied_company_needs?: Array<{
    need: string;
    confidence?: number;
    evidence?: string[];
  }>;
  candidate_hidden_value?: Array<{
    value: string;
    maps_to_need?: string;
    confidence?: number;
    evidence?: string[];
  }>;
  questions_to_validate?: string[];
};

export type ShortlistItem = {
  key: string;
  savedAt: string;
  job: JobPayload;
  analysis: JobAnalysis;
};
