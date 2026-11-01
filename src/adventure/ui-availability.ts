import type { MarketManifest } from "./market";
import { emptyResearchProfile, fundingScenarioFromRun, type RecommendationAvailability, type ResearchProfile } from "./research";
import type { Run } from "./types";
import { researchCaseChoices } from "./ui-research-cases";

/** Resource availability only; it does not fetch prices or create observations. */
export function taskAvailability(run: Run, profile: ResearchProfile, manifest: MarketManifest | null, wasCaseSeen?: (caseId: string) => boolean): RecommendationAvailability {
  let funding: "journey" | "example" | "unavailable";
  try {
    const derived = fundingScenarioFromRun(run);
    funding = derived?.scenario.events.some((event) => event.kind === "purchase") ? "journey" : "example";
  } catch { funding = "unavailable"; }
  // A disabled profile is deliberately not consulted for past tasks or preferences.
  const safeProfile = profile.enabled ? profile : emptyResearchProfile(false, run.source);
  if (safeProfile.research_process.some((attempt) => !attempt.submitted)) return { funding, history: "pending" };
  if (!manifest) return { funding, history: "unavailable" };
  const choices = researchCaseChoices(manifest.cases, run, safeProfile, wasCaseSeen);
  return { funding, history: choices.some((choice) => !choice.seen) ? "unseen" : choices.length ? "review" : "unavailable" };
}
