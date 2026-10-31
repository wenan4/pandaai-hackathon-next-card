import { validateResearchProfile } from './profile-validation';
import { validateRun } from './save-validation';
import type { ResearchProfile } from './research';
import type { Run } from './types';

export interface AdventureSave {
  schema: 'nextcard-adventure-save-v1';
  savedAt: number;
  observationStartedAt: number;
  priorExposure?: boolean;
  tutorialStep?: number;
  run: Run;
  profile: ResearchProfile;
}
export type AdventureSaveResult =
  | { kind: 'empty' }
  | { kind: 'valid'; value: AdventureSave }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'invalid'; reason: string };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const invalid = (): AdventureSaveResult => ({ kind: 'invalid', reason: '存档内容不完整或损坏。' });
const unsupported = (): AdventureSaveResult => ({ kind: 'unsupported', reason: '存档版本暂不受支持。' });

/** Parse only; the caller retains the original bytes and owns all storage decisions. */
export function parseAdventureSave(raw: string | null): AdventureSaveResult {
  if (raw === null) return { kind: 'empty' };
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { return invalid(); }
  if (!record(value)) return invalid();
  if (typeof value.schema !== 'string') return invalid();
  if (value.schema !== 'nextcard-adventure-save-v1') return unsupported();
  if (!record(value.run) || !record(value.profile)) return invalid();
  if (typeof value.run.version !== 'string' || typeof value.profile.version !== 'string') return invalid();
  if (value.run.version !== '0.4.1' || value.profile.version !== 'research-v1') return unsupported();
  if (!timestamp(value.savedAt) || !timestamp(value.observationStartedAt)
    || (value.priorExposure !== undefined && typeof value.priorExposure !== 'boolean')
    || (value.tutorialStep !== undefined && (typeof value.tutorialStep !== 'number' || !Number.isInteger(value.tutorialStep) || value.tutorialStep < 0 || value.tutorialStep > 4))
    || !validateRun(value.run)) return invalid();
  const profile = validateResearchProfile(value.profile, 'real');
  if (!profile.ok || profile.profile.enabled !== value.run.observationEnabled) return invalid();
  return { kind: 'valid', value: { ...value, run: value.run, profile: profile.profile } as unknown as AdventureSave };
}
