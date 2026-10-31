import type { MarketCaseSummary } from "./market";
import type { ResearchProfile } from "./research";
import type { Run } from "./types";
import { casesAreRelated } from "./ui-case";

export interface ResearchCaseChoice { summary: MarketCaseSummary; seen: boolean }

/** Prefer genuinely unseen, unrelated windows while keeping known ones available for review. */
export function researchCaseChoices(cases: MarketCaseSummary[], run: Run, profile: ResearchProfile, wasSeen?: (caseId: string) => boolean): ResearchCaseChoice[] {
  return cases.filter((item) => run.status !== "active" || !casesAreRelated(item.caseId, run.caseId)).map((summary) => {
    const related = (id: string): boolean => casesAreRelated(id, summary.caseId);
    const seen = !!wasSeen?.(summary.caseId)
      || (run.status !== "active" && related(run.caseId) && run.history.some((event) => event.type === "market" && event.data.stage !== "entry"))
      || (profile.prior_exposure_disclosures ?? []).some((item) => item.relatedCaseIds.some(related))
      || profile.research_process.some((item) => !!item.shown && (related(item.caseId) || (!!item.shown.other && related(item.shown.other.caseId))))
      || profile.funding_attempts.some((item) => related(item.caseId))
      || profile.calibration.some((item) => related(item.context.caseId));
    return { summary, seen };
  }).sort((a, b) => Number(a.seen) - Number(b.seen));
}

export function otherResearchCase(choices: ResearchCaseChoice[], primaryId: string): string {
  return choices.find(({ summary }) => !casesAreRelated(summary.caseId, primaryId))?.summary.caseId ?? "";
}
