export interface DisclosureSection { id: string; heading: string; points: string[] }

export interface LearningSettingsView {
  learningEnabled: boolean;
  learningPaused: boolean;
  approvedGuidanceEnabled: boolean;
  learningActive: boolean;
  blockedReason: 'not_enabled' | 'disclosure_outdated' | 'paused' | null;
  optInAvailable: boolean;
  enabledAt: string | null;
  disclosure: { version: string; title: string; summary: string; sections: DisclosureSection[] };
  acknowledgement: { version: string | null; at: string | null; byId: string | null; current: boolean; needsAcknowledgement: boolean };
  usage: { workspaceMicros: string; workspaceCapMicros: string };
}

export interface PrivacyHoldings {
  interactionRecordsWithText: number;
  oldestInteractionRecordAt: string | null;
  evaluations: number;
  evaluationsWithText: number;
  reviewTasksWithText: number;
  trainingExamples: { total: number; approved: number; byStatus: Record<string, number> };
  styleEvidenceItems: number;
  automaticDeletion: { enabled: boolean; freeTextDays: number; metricsMonths: number };
}

export type ExampleStatus = 'DRAFT' | 'REVIEW' | 'APPROVED' | 'REJECTED' | 'ARCHIVED';

export interface TrainingExample {
  id: string;
  status: ExampleStatus;
  customerInput: string;
  expectedResponse: string | null;
  expectedAction: string | null;
  createdAt: string;
  approvedAt: string | null;
  /** What this example currently does to AI replies. */
  influence: 'guidance' | 'style_correction' | 'none';
  regressionCaseCreated: boolean;
}

/** Turns an API error into a sentence an administrator can act on (the server's message when it sent one). */
export function apiErrorMessage(e: unknown, fallback: string): string {
  const data = (e as { response?: { data?: { message?: unknown } } } | null)?.response?.data;
  if (typeof data?.message === 'string' && data.message) return data.message;
  const message = (e as Error | null)?.message;
  return message && !/status code/i.test(message) ? message : fallback;
}

export const microsToUsd = (micros: string): string => (Number(micros) / 1_000_000).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
