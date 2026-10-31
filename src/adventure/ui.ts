import "./adventure.css";
import { h, type Child } from "../ui/dom";
import { createRun, forkRun, pendingMarketStep, reduceRun } from "./engine";
import { CARDS, ENEMIES } from "./content";
import { discardRejectedMarketStage, loadMarketInitial, loadMarketInitialCase, loadMarketStage, loadResearchCase, type MarketInitialCase, type MarketManifest } from "./market";
import { addUserReason, compareSchedule, compareSelfForecast, declarePriorExposure, emptyResearchProfile, markHistoryHelp, recommendResearch, revokeResearch, setHelpPreference, setResearchGoal, showHistoryEvidence, startHistory, submitHistory, updateJourney, type Direction, type Goal, type HelpPreference, type ResearchProfile } from "./research";
import type { CardId, Run, RunAction } from "./types";
import { button, coins, dateText, pill } from "./ui-components";
import { gameView, nodeNames, type GameReceipt } from "./ui-game";
import { actionFeedback } from "./game-feedback";
import { ResearchUI } from "./ui-research";
import { makeDemoPath } from "./ui-demo";
import { mergeFundingExposures, type FundingExposureArchive } from "./ui-exposure";
import { adventureBackup, clearAdventureStorage, expireAdventureStorage, FUNDING_EXPOSURE_KEY, inspectAdventureStorage, replaceAdventureStorage, RETENTION_MS, SAVE_KEY, SEEN_KEY, type RecoveryIssue, type StorageRead, type StorageSnapshot } from "./ui-storage";
import type { AdventureSave } from "./save-state";
import { reportView } from "./ui-report";
import { casesAreRelated, chooseAdventureCase, hasSeenRelatedCase, independentBattleSeed } from "./ui-case";
import { CalibrationDemoUI } from "./ui-calibration-demo";
import { dataInfoContent } from "./ui-data-info";
import { pileView, type PileKind } from "./ui-piles";
import { enemyPlanView } from "./ui-enemy";

const app = document.querySelector<HTMLDivElement>("#app")!;
type Screen = "intro" | "game" | "report" | "d1" | "d2" | "judge";
type Save = AdventureSave;
interface RecoveryState { current: StorageSnapshot | null; backup: StorageSnapshot | null; issues: RecoveryIssue[]; summary: Save | null; unavailable: boolean; uncertain: boolean; message: string | null }
let run: Run | null = null;
let profile: ResearchProfile = emptyResearchProfile();
let realSave: Save | null = null;
let recovery: RecoveryState | null = null;
let observationStartedAt = Date.now();
let priorExposure = false;
let seenCases = new Set<string>();
let fundingExposureArchive: FundingExposureArchive = { version: 1, createdAt: Date.now(), entries: [] };
let screen: Screen = "intro";
let manifest: MarketManifest | null = null;
let initialCase: MarketInitialCase | null = null;
let initialCaseLoading = false;
let initialCaseError: string | null = null;
let initialCaseVersion = 0;
let initialError: string | null = null;
let marketError: string | null = null;
let marketLoading = false;
let initialLoading = false;
let storageError = false;
let selectedCard: string | null = null;
let selectedRetain: string | null = null;
let selectedUpgrade: string | null = null;
let selectedReward: CardId | null = null;
let battleFeedback = "";
let gameFeedback: GameReceipt | null = null;
let tutorialStep = 4;
let entryCents = 0;
let reserveCents = 0;
let modal: HTMLElement | null = null;
let modalOpener: { key?: string; label?: string } | null = null;
let toastMessage = "";
let toastTimer = 0;
let demoLoading = false;
let judgeStudyLoading = false;
let judgeStudy: { label: string; status: string; recommendation: string; help: string }[] | null = null;
let demoVersion = 0;
let judgeStudyVersion = 0;
let requestVersion = 0;
let idCounter = 0;
const uid = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${++idCounter}`;
const errorMessage = (error: unknown): string => error instanceof TypeError && /fetch|network/i.test(error.message) ? "网络连接暂时不可用，请重试。" : error instanceof Error ? error.message : "加载未完成，请重试。";

function resetGameUi(): void {
  selectedCard = null; selectedRetain = null; selectedUpgrade = null; selectedReward = null;
  battleFeedback = ""; gameFeedback = null; toastMessage = "";
  window.clearTimeout(toastTimer); toastTimer = 0;
}
function selectReward(id: CardId | null): void {
  const previous = selectedReward;
  selectedReward = id;
  render();
  if (id === null && previous) app.querySelector<HTMLElement>(`[data-focus-key="reward-${previous}"]`)?.focus({ preventScroll: true });
}

function writeLocal(key: string, value: string): boolean {
  if (recovery) return false;
  try { localStorage.setItem(key, value); return true; } catch { storageError = true; return false; }
}
function save(): boolean {
  if (!run || run.source !== "real") return true;
  const data: Save = { schema: "nextcard-adventure-save-v1", savedAt: Date.now(), observationStartedAt, priorExposure, tutorialStep, run, profile };
  if (!writeLocal(SAVE_KEY, JSON.stringify(data))) return false;
  realSave = data;
  return true;
}
function rememberFundingExposures(next: ResearchProfile): void {
  if (recovery || run?.source !== "real" || !next.enabled || !next.funding_exposure.length) return;
  if (Date.now() - fundingExposureArchive.createdAt >= RETENTION_MS) fundingExposureArchive = { version: 1, createdAt: Date.now(), entries: [] };
  if (!fundingExposureArchive.entries.length) fundingExposureArchive.createdAt = Date.now();
  fundingExposureArchive.entries = mergeFundingExposures(fundingExposureArchive.entries, next.funding_exposure);
  writeLocal(FUNDING_EXPOSURE_KEY, JSON.stringify(fundingExposureArchive));
}
function clearFundingExposures(): boolean {
  if (recovery) return false;
  try { localStorage.removeItem(FUNDING_EXPOSURE_KEY); } catch { storageError = true; return false; }
  fundingExposureArchive = { version: 1, createdAt: Date.now(), entries: [] };
  return true;
}
function setProfile(next: ResearchProfile): void { if (recovery) return; profile = next; rememberFundingExposures(profile); save(); render(); }
function flash(message: string): void {
  toastMessage = message; window.clearTimeout(toastTimer); render();
  toastTimer = window.setTimeout(() => { toastMessage = ""; render(); }, 4500);
}
function changeScreen(next: Screen): void {
  if ((screen === "d1" || screen === "d2") && next !== screen) researchUI.leave();
  screen = next; selectedCard = null; modal = null; render(false); window.scrollTo({ top: 0, behavior: "auto" });
}
function showDialog(title: string, body: Child, actions: Child[]): void {
  const active = document.activeElement as HTMLElement | null;
  if (!modal) modalOpener = { key: active?.dataset.focusKey, label: active?.closest("button")?.textContent ?? undefined };
  const previousKey = modal?.contains(active) ? active?.dataset.focusKey : undefined;
  const dialog = h("section", { class: "modal stack", role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1" }, h("h2", null, title), body, h("div", { class: "button-row" }, actions));
  const focusable = (): HTMLElement[] => [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex="0"]')].filter((element) => element.getClientRects().length > 0);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeDialog(); return; }
    if (event.key !== "Tab") return;
    const elements = focusable(); const first = elements[0]; const last = elements.at(-1);
    if (!first) { event.preventDefault(); dialog.focus(); }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last!.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
  });
  modal = h("div", { class: "modal-backdrop", onclick: (e: Event) => { if (e.target === e.currentTarget) closeDialog(); } }, dialog);
  render(); window.setTimeout(() => {
    if (!dialog.isConnected) return;
    const previous = previousKey ? dialog.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(previousKey)}"]`) : null;
    (previous ?? focusable()[0] ?? dialog).focus({ preventScroll: true });
  }, 0);
}
function closeDialog(): void {
  const opener = modalOpener; modal = null; modalOpener = null; render();
  const keyed = opener?.key ? app.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(opener.key)}"]`) : null;
  const named = [...app.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent === opener?.label && !element.disabled && element.getClientRects().length > 0);
  (keyed ?? named)?.focus({ preventScroll: true });
}
function restoredTutorial(current: Run, saved?: number): number {
  if (current.source !== "real" || current.node !== "N1" || current.phase !== "battle" || !current.battle) return 4;
  if (typeof saved === "number" && Number.isInteger(saved) && saved >= 0 && saved <= 4) return saved;
  if (current.battle.turn > 1) return 4;
  return current.history.some((event) => event.action === "play-card") ? 3 : 0;
}
function setTutorialStep(step: number): void { tutorialStep = Math.max(0, Math.min(4, step)); save(); render(); }
function askNewRun(enabled: boolean): void {
  if (recovery) return;
  if (realSave) {
    showDialog("开启新的旅程？", h("p", { class: "hint" }, "已保存的真实冒险进度会被新旅程替换。"), [button("开始新旅程", () => { modal = null; startRun(enabled); }, "gold"), button("保留已有旅程", closeDialog, "secondary")]);
  } else startRun(enabled);
}
function cancelMarketRequest(): void { requestVersion++; marketLoading = false; marketError = null; }
function resetInitialCase(): void { initialCaseVersion++; initialCase = null; initialCaseLoading = false; initialCaseError = null; }
/** Called only after a run has fixed its case; it never fetches other cases' histories. */
function ensureInitialCase(): void {
  if (recovery || !run || initialCaseLoading || initialCaseError || initialCase?.caseId === run.caseId) return;
  const caseId = run.caseId; const runId = run.id; const version = ++initialCaseVersion;
  initialCaseLoading = true; render();
  void Promise.resolve().then(() => loadMarketInitialCase(caseId, true)).then((data) => {
    if (version !== initialCaseVersion || !run || run.id !== runId || run.caseId !== caseId) return;
    initialCase = data; initialCaseLoading = false; render();
  }).catch((error: unknown) => {
    if (version !== initialCaseVersion || !run || run.id !== runId || run.caseId !== caseId) return;
    initialCaseLoading = false; initialCaseError = errorMessage(error); render();
  });
}
function retryInitialCase(): void { initialCaseError = null; ensureInitialCase(); }
function invalidatePendingComparison(existing: ResearchProfile, exposedCase: string): ResearchProfile {
  if (!existing.enabled) return existing;
  return { ...existing, calibration: existing.calibration.map((item) => {
    if (item.action !== null || !casesAreRelated(item.context.caseId, exposedCase)) return item;
    const forecast = existing.forecasts.find((entry) => entry.id === item.forecastId);
    if (!forecast) return item;
    return { ...compareSelfForecast(forecast, { ...item.context, priorExposure: true }, item.feeling, null), reason: item.reason };
  }) };
}
/** External displays reveal a case independently of this real run's natural timeline. */
function markExternalExposure(caseId: string, invalidatePending = true): void {
  if (recovery) return;
  seenCases.add(caseId);
  if (realSave && casesAreRelated(realSave.run.caseId, caseId)) {
    realSave = { ...realSave, priorExposure: true, profile: invalidatePending ? invalidatePendingComparison(realSave.profile, caseId) : realSave.profile };
    if (run?.source === "real" && run.id === realSave.run.id) { priorExposure = true; profile = realSave.profile; }
    writeLocal(SAVE_KEY, JSON.stringify(realSave));
  }
  writeLocal(SEEN_KEY, JSON.stringify([...seenCases]));
}
/** Showing this run's own T0 history affects later replays, not its current forecast. */
function markNaturalArchiveSeen(caseId: string): void {
  if (recovery) return;
  if (seenCases.has(caseId)) return;
  seenCases.add(caseId);
  writeLocal(SEEN_KEY, JSON.stringify([...seenCases]));
}
function startRun(enabled: boolean): void {
  if (recovery) return;
  if (!manifest?.cases.length) { flash("案例目录尚未准备好，请重试加载。"); if (!initialLoading) loadInitial(); return; }
  const chosen = chooseAdventureCase(manifest.cases.map((item) => item.caseId), seenCases);
  const now = Date.now(); const expiredArchive = now - fundingExposureArchive.createdAt >= RETENTION_MS;
  const nextRun = createRun({ caseId: chosen.caseId, observationEnabled: enabled, source: "real", seed: independentBattleSeed() });
  const nextProfile = { ...emptyResearchProfile(enabled), funding_exposure: enabled && !expiredArchive ? structuredClone(fundingExposureArchive.entries) : [] };
  const nextSave: Save = { schema: "nextcard-adventure-save-v1", savedAt: now, observationStartedAt: now, priorExposure: chosen.priorExposure, tutorialStep: 0, run: nextRun, profile: nextProfile };
  if (!writeLocal(SAVE_KEY, JSON.stringify(nextSave))) { flash("未能保存新旅程；原来的本地记录未替换，请检查存储设置后重试。"); return; }
  cancelMarketRequest(); resetInitialCase();
  if (expiredArchive && !clearFundingExposures()) fundingExposureArchive = { version: 1, createdAt: now, entries: [] };
  resetGameUi(); run = nextRun; profile = nextProfile; realSave = nextSave; priorExposure = chosen.priorExposure; observationStartedAt = now; tutorialStep = 0; entryCents = 0; reserveCents = 0;
  changeScreen("game"); ensureInitialCase();
}
function action(next: RunAction): void {
  if (recovery || !run) return;
  const previousPhase = run.phase; const previousNode = run.node;
  const before = run;
  let updatedRun: Run;
  try { updatedRun = reduceRun(before, next); }
  catch (error) {
    if (next.type === "apply-quote" && before.phase === "market" && before.market.pending) {
      discardRejectedMarketStage(before.market.pending.caseId, before.market.pending.stage);
      marketLoading = false; marketError = errorMessage(error); render();
    }
    else { gameFeedback = null; flash(errorMessage(error)); }
    return;
  }
  try {
    run = updatedRun;
    const feedback = actionFeedback(before, run, next);
    if (feedback) {
      const area: GameReceipt["area"] = next.type === "choose-reward" ? "journey" : next.type === "free-rest" || next.type === "free-upgrade" ? "free" : "shop";
      gameFeedback = { area, result: feedback };
    } else if (next.type !== "apply-quote" && next.type !== "open-archive") gameFeedback = null;
    if (before.phase !== run.phase || before.node !== run.node) selectedReward = null;
    if (feedback && (next.type === "upgrade-card" || next.type === "free-upgrade")) selectedUpgrade = null;
    if (before.node === "N1" && before.phase === "battle") {
      if (next.type === "play-card" && tutorialStep < 3) tutorialStep = 3;
      if (next.type === "end-turn" || run.phase !== "battle") tutorialStep = 4;
    }
    if (next.type === "play-card" && before.battle) {
      const card = before.deck.find((item) => item.instanceId === next.cardInstanceId);
      const name = card ? CARDS[card.cardId].name : "卡牌";
      if (!run.battle) battleFeedback = `${name} · 击败了${ENEMIES[before.battle.enemy.id].name}！`;
      else {
        const hpLoss = before.battle.enemy.hp - run.battle.enemy.hp;
        const shieldLoss = before.battle.enemy.shield - run.battle.enemy.shield;
        const shieldGain = run.battle.shield - before.battle.shield;
        const growth = run.battle.capacity - before.battle.capacity;
        const effects = [hpLoss > 0 ? `对手生命 −${hpLoss}` : "", shieldLoss > 0 ? `击破护盾 ${shieldLoss}` : "", shieldGain > 0 ? `获得护盾 ${shieldGain}` : "", growth > 0 ? `容量 +${growth}（下回合生效）` : ""].filter(Boolean);
        battleFeedback = `${name} · ${effects.length ? effects.join(" · ") : card ? (card.upgraded ? CARDS[card.cardId].upgradedDescription : CARDS[card.cardId].description) : "已打出"}`;
      }
    } else if (next.type === "end-turn" && before.battle) {
      const lost = Math.max(0, before.hp - run.hp); const intent = before.battle.enemy.intent;
      battleFeedback = intent.kind === "attack" ? `对方攻击 ${intent.amount} · 生命减少 ${lost}` : `对方获得 ${intent.amount} 护盾`;
    } else if (run.phase === "battle" && previousPhase !== "battle") battleFeedback = "";
    researchUI.afterAction(next);
    if (run.source === "real" && next.type === "apply-quote" && ["t1", "t2", "t3"].includes(next.quote.step)) {
      seenCases.add(run.caseId); writeLocal(SEEN_KEY, JSON.stringify([...seenCases]));
    }
    if (profile.enabled) profile = updateJourney(profile, run);
    if (next.type === "play-card" || next.type === "end-turn") { selectedCard = null; selectedRetain = null; }
    if (next.type === "purchase-attempted") flash("可用金币不足，这次购买没有完成。");
    save();
    if (run.phase === "ended") screen = "report";
    const changed = previousPhase !== run.phase || previousNode !== run.node;
    render(!changed);
    if (next.type === "end-turn" && run.phase === "battle") {
      const hand = app.querySelector<HTMLElement>('[data-scroll-key="battle-hand"]');
      if (hand) hand.scrollLeft = 0;
    }
    if (changed) window.scrollTo({ top: 0, behavior: "auto" });
    else if (feedback) app.querySelector<HTMLElement>(`[data-game-receipt="${gameFeedback?.area}"]`)?.scrollIntoView({ behavior: "auto", block: "nearest" });
    queueMarket();
  } catch (error) { gameFeedback = null; flash(errorMessage(error)); }
}
function queueMarket(): void {
  if (recovery || !run || run.phase !== "market" || marketLoading || marketError) return;
  const pending = pendingMarketStep(run); if (!pending) return;
  const capturedRun = run; const version = ++requestVersion; marketLoading = true; render();
  void Promise.resolve().then(() => version === requestVersion && run === capturedRun ? loadMarketStage(pending.caseId, pending.stage, pending.unlocked) : null).then((quote) => {
    if (!quote || version !== requestVersion || run !== capturedRun) return;
    marketLoading = false; action({ type: "apply-quote", quote });
  }).catch((error: unknown) => {
    if (version !== requestVersion || run !== capturedRun) return;
    marketLoading = false; marketError = errorMessage(error); render();
  });
}
function retryMarket(): void { marketError = null; queueMarket(); render(); }
function loadInitial(): void {
  if (initialLoading) return;
  initialLoading = true; initialError = null; render();
  void loadMarketInitial().then((data) => { manifest = data; initialLoading = false; render(); }).catch((error: unknown) => { initialLoading = false; initialError = errorMessage(error); render(); });
}
function restoreReal(): void {
  if (!realSave) { flash("还没有真实旅程记录。"); return; }
  cancelMarketRequest(); resetInitialCase(); resetGameUi();
  run = structuredClone(realSave.run); profile = structuredClone(realSave.profile); if (profile.enabled) profile.funding_exposure = mergeFundingExposures(profile.funding_exposure, fundingExposureArchive.entries); observationStartedAt = realSave.observationStartedAt; priorExposure = realSave.priorExposure ?? false; tutorialStep = restoredTutorial(run, realSave.tutorialStep);
  changeScreen(run.phase === "ended" ? "report" : "game"); ensureInitialCase(); queueMarket();
}
function clearAllLocalRecords(): void {
  const before = inspectLocalStorage(); const backup = recovery?.backup ?? (before.kind === "unavailable" ? null : before.snapshot);
  const wasUncertain = !!recovery?.uncertain;
  if (before.kind === "unavailable") { enterRecovery(before, backup, "无法读取本地记录，未开始清除；请检查存储设置后重试。", wasUncertain); render(); return; }
  let outcome: ReturnType<typeof clearAdventureStorage>;
  try { outcome = clearAdventureStorage(window.localStorage, before.snapshot); } catch { outcome = "failed-restored"; }
  if (outcome !== "saved") {
    const message = outcome === "changed" ? "本机记录已变化，未开始清除；请重新读取后再确认。" : outcome === "failed-uncertain" ? "清除未完成，原记录也未能完全恢复；部分本机内容可能已变化。请先下载此前读取的备份。" : "未能完成清除，原记录已保留；请检查存储设置后重试。";
    enterRecovery(inspectLocalStorage(), backup, message, wasUncertain || outcome === "failed-uncertain"); render(); return;
  }
  recovery = null; storageError = false; fundingExposureArchive = { version: 1, createdAt: Date.now(), entries: [] }; seenCases.clear(); cancelMarketRequest(); resetInitialCase(); resetJudgeDemos(); resetGameUi(); run = null; realSave = null; profile = emptyResearchProfile(); modal = null; changeScreen("intro"); flash("本地冒险记录已清除。");
}
function settings(): void {
  const state = !recovery && run?.observationEnabled && profile.enabled;
  const touchedCases = new Set<string>();
  if (run) touchedCases.add(run.caseId);
  for (const attempt of profile.research_process) { if (attempt.shown) { touchedCases.add(attempt.caseId); if (attempt.shown.other) touchedCases.add(attempt.shown.other.caseId); } }
  for (const attempt of profile.funding_attempts) if (attempt.caseId !== "manual-example") touchedCases.add(attempt.caseId);
  const caseLabel = (caseId: string): string => { const item = manifest?.cases.find((entry) => entry.caseId === caseId); return `${caseId === run?.caseId ? "本局" : "历史片段"} · ${item ? `${item.name} · ${dateText(item.decisionDate)}` : caseId}`; };
  const selectedCase = h("select", { "aria-label": "选择要补充的案例" }, [...touchedCases].map((caseId) => h("option", { value: caseId, selected: caseId === run?.caseId }, caseLabel(caseId))));
  const body = h("div", { class: "stack" }, h("p", { class: "hint" }, "进度保存在这台设备的浏览器中，不会默认上传。观察从开启起最多保存 30 天，过期后移除观察并保留游戏进度。"),
    h("p", { class: "hint" }, recovery ? "本地记录尚未恢复，当前不生成观察。" : !run ? "尚未开始旅程，不生成观察。" : state ? "当前：生成本局观察。" : "当前：只玩游戏，不保存观察。"),
    run?.source === "real" ? h("div", { class: "stack" }, h("p", { class: "hint" }, "如果在相关任务和预期之前已看过某个案例，可主动说明。相关观察会按已见处理；玩法和奖励不变。"), h("label", { class: "field" }, "选择要补充的案例", selectedCase), button("我之前看过这个案例", () => {
      const chosenCaseId = selectedCase.value;
      if (!touchedCases.has(chosenCaseId)) { flash("请选择已经接触过的案例。"); return; }
      showDialog("确认你在此前已看过？", h("p", { class: "hint" }, `请仅在相关任务和事前预期之前就了解“${caseLabel(chosenCaseId)}”时确认。此前的操作与自报会保留，相关观察将重新核对；游戏奖励不变。`), [button("确认：此前已看过", () => {
        if (!run || run.source !== "real") return;
        try {
          const caseId = chosenCaseId;
          const correction = profile.enabled ? declarePriorExposure(profile, { id: uid("disclosure"), caseId, priorToTasks: true }) : null;
          if (correction) { profile = correction.profile; rememberFundingExposures(profile); save(); }
          markExternalExposure(caseId, false); save();
          const affected = (correction?.changes.length ?? 0) + (correction?.calibrationChanges.length ?? 0);
          showDialog("已记录你的补充", h("p", { class: "hint" }, affected ? `已重新核对 ${affected} 项相关观察。原来的任务操作、预期和感受均保留。` : "之后相关案例会按已见处理；原有操作和游戏进度保留。"), [button("知道了", closeDialog, "secondary")]);
        } catch (error) { flash(errorMessage(error)); }
      }, "secondary"), button("取消", closeDialog, "ghost")]);
    }, "secondary"), priorExposure ? pill("此案例按已见处理", "blue") : null) : null,
    state ? button("撤销观察并删除观察记录", () => showDialog("撤销本局观察？", h("p", { class: "hint" }, run?.source === "real" ? "目标、预期、感受、原因、研究观察与跨局提示暴露记录将删除；冒险进度会保留。" : "当前模拟的观察会删除；真实旅程与其观察保留。"), [button("确认撤销", () => { if (run?.source === "real" && !clearFundingExposures()) { flash("未能删除本地观察记录，请检查存储设置后重试。"); return; } profile = revokeResearch(profile); if (run) run.observationEnabled = false; modal = null; const saved = save(); flash(saved ? "观察已撤销，游戏进度保留。" : "已停止观察，但未能更新本地存档，请检查存储设置。"); }, "danger"), button("返回", closeDialog, "secondary")]), "secondary") : null,
    button("清除全部本地记录", () => showDialog("清除这台设备的冒险记录？", h("p", { class: "hint" }, "当前冒险与本局观察会删除，此操作无法撤销。旧版 v0.3 存档不受影响。"), [button("确认清除", clearAllLocalRecords, "danger"), button("返回", closeDialog, "secondary")]), "danger"));
  showDialog("旅程与隐私设置", body, [button("完成", closeDialog, "secondary")]);
}
function dataInfo(): void {
  showDialog("关于这段历史", dataInfoContent(manifest, run), [button("知道了", closeDialog, "secondary")]);
}
function openPile(pile: PileKind): void {
  if (!run?.battle || run.phase !== "battle") return;
  showDialog("查看牌组", pileView(run, pile), [button("返回战斗", closeDialog, "secondary")]);
}
function openEnemyPlan(): void {
  if (!run?.battle || run.phase !== "battle") return;
  showDialog("对手行动节奏", enemyPlanView(run), [button("返回战斗", closeDialog, "secondary")]);
}
function topbar(): HTMLElement {
  return h("header", { class: "topbar" }, h("button", { type: "button", class: "brand", onclick: () => changeScreen("intro"), "aria-label": "回到冒险首页" }, h("span", { class: "brand-mark", "aria-hidden": "true" }, "灯"), h("span", null, h("span", { class: "brand-name" }, "下一张牌"), h("span", { class: "brand-sub" }, "A LITTLE JOURNEY"))),
    h("nav", { class: "top-actions", "aria-label": "功能导航" }, run ? h("button", { type: "button", class: "link-button back-link", onclick: () => changeScreen(run?.phase === "ended" ? "report" : "game") }, run.phase === "ended" ? "旅程报告" : "回到旅程") : null, run && profile.enabled ? h("button", { type: "button", class: "link-button prefs-link", onclick: () => showDialog("目标与帮助（可跳过）", preferencePanel(), [button("完成", closeDialog, "secondary")]) }, "目标与帮助") : null, h("button", { type: "button", class: "link-button data-link", onclick: dataInfo }, "数据说明"), run ? h("button", { type: "button", class: "link-button judge-link", onclick: () => changeScreen("judge") }, "评委面板") : null, h("button", { type: "button", class: "link-button settings-link", onclick: settings }, "设置")));
}
function intro(): HTMLElement {
  return h("div", { class: "intro" }, topbar(), h("main", { class: "intro-hero", id: "main-content" }, h("div", { class: "intro-content" }, h("div", { class: "intro-kicker" }, "一段轻盈的卡牌冒险"), h("h1", null, "下一张牌", h("span", null, "晨光小城 · 守灯之旅")), h("p", { class: "intro-lead" }, "带上你的牌组，穿过晨雾渐散的小城。一路战斗、收集新牌、安排补给，去寻回那盏温暖的灯。"),
    h("div", { class: "intro-actions" }, run ? button(run.phase === "ended" ? "查看上次旅程" : "继续上次旅程", () => { changeScreen(run?.phase === "ended" ? "report" : "game"); queueMarket(); }, "gold", false, "resume") : null,
      button(run ? "开始新旅程 · 生成观察" : "开始旅程 · 生成本局观察", () => askNewRun(true), "", !manifest, "start-observation"), button("只玩游戏", () => askNewRun(false), "secondary", !manifest, "start-game-only")),
    h("p", { class: "intro-note" }, "可选生成本局观察与研究任务。记录仅保存在本机，随时撤销；只玩游戏不记录兴趣、感受或原因。"),
    initialError ? h("div", { class: "notice error", style: "margin-top:14px" }, initialError, " ", button("重试数据", loadInitial, "small secondary", initialLoading)) : null)),
    h("div", { class: "intro-bottom" }, h("div", { class: "intro-feature" }, h("strong", null, "出牌，找到你的组合"), h("span", null, "读懂对手意图，拿新牌，走出自己的打法。")), h("div", { class: "intro-feature" }, h("strong", null, "经营，一路保有选择"), h("span", null, "补给、卡牌与契约共享同一段旅程。")), h("div", { class: "intro-feature" }, h("strong", null, "回望，再试一种可能"), h("span", null, "观察只描述本局，下一步由你选择。"))), h("footer", { class: "footer" }, "虚拟金币不兑换现金 · 历史案例不代表未来 · 现实财务承受能力未评估"));
}
function preferencePanel(): HTMLElement {
  const goal = profile.stated_interest.at(-1)?.goal ?? null; const help = profile.help_preference.at(-1)?.help;
  return h("section", { class: "panel stack" }, h("h2", null, "下一步，你想探索什么？"), h("p", { class: "hint" }, "这是此刻的目标，可以跳过或随时修改，不是固定标签。"),
    h("div", { class: "selection-row" }, ([ ["funding", "资金安排"], ["history", "历史比较"], ["idea", "验证一个想法"], ["none", "暂不选择"] ] as const).map(([id, label]) => h("button", { type: "button", class: `choice${(id === "none" ? goal === null : goal === id) ? " selected" : ""}`, "aria-pressed": String(id === "none" ? goal === null : goal === id), "data-focus-key": `preference-goal-${id}`, onclick: () => { setProfile(setResearchGoal(profile, uid("goal"), id === "none" ? null : id as Goal)); if (modal) showDialog("目标与帮助（可跳过）", preferencePanel(), [button("完成", closeDialog, "secondary")]); } }, label))),
    h("p", { class: "hint strong" }, "希望怎样获得帮助？"), h("p", { class: "fineprint" }, help ? "任务会使用你选择的帮助方式；随时可以调整。" : "尚未选择。进入任务后可查看建议，再决定是否使用帮助。"), h("div", { class: "selection-row" }, ([ ["self", "自主尝试"], ["hint", "给我提示"], ["step", "分步说明"] ] as const).map(([id, label]) => h("button", { type: "button", class: `choice${help === id ? " selected" : ""}`, "aria-pressed": String(help === id), "data-focus-key": `preference-help-${id}`, onclick: () => { setProfile(setHelpPreference(profile, uid("help"), id as HelpPreference)); if (modal) showDialog("目标与帮助（可跳过）", preferencePanel(), [button("完成", closeDialog, "secondary")]); } }, label))));
}
function report(): HTMLElement {
  return reportView({ run: run!, profile, manifest, wasCaseSeen: (caseId) => hasSeenRelatedCase(seenCases, caseId), header: topbar(), preferences: profile.enabled ? preferencePanel() : null, calibration: profile.enabled ? researchUI.calibrationReport() : null,
    openTask: (task) => changeScreen(task === "D1" ? "d1" : "d2"), resume: () => changeScreen("game"), newRun: () => askNewRun(profile.enabled), home: () => changeScreen("intro"),
    saveReason: (evidenceId, reason) => { if (!reason) { flash("请选择一个原因。"); return; } setProfile(addUserReason(profile, uid("reason"), evidenceId, reason)); flash("已保存你的补充。"); } });
}
function judge(): HTMLElement {
  const current = run!;
  const checkpoints = current.checkpoints.filter((cp) => ["submit-entry", "buy-archive", "open-archive", "submit-redemption"].includes(cp.action));
  return h("div", { class: "app-shell" }, topbar(), h("main", { class: "page-grid", id: "main-content" }, h("div", { class: "main-column" }, h("section", { class: "panel stack" }, h("div", { class: "eyebrow" }, "JUDGE'S TABLE"), h("h2", null, "评委面板"), h("p", { class: "hint" }, "真实回放、预设模拟和从决策前状态重新出发的分叉，都会标明来源。后续失效的行动不会冒充真实记录。"), h("div", { class: "button-row" }, pill(current.source === "real" ? "真实记录" : current.source === "fork" ? "模拟 · 分叉" : "模拟 · 预设", current.source === "real" ? "blue" : "gold"), realSave && current.source !== "real" ? button("恢复真实旅程", restoreReal, "small secondary") : null)),
    h("section", { class: "panel stack" }, h("h3", null, "两条模拟路径"), h("p", { class: "hint" }, "调用正式规则与分段行情生成；演示不是玩家的真实行为。"), h("div", { class: "button-row" }, button(demoLoading ? "正在生成…" : "路径甲 · 查看资料", () => void openDemo("A"), "secondary", demoLoading), button(demoLoading ? "正在生成…" : "路径乙 · 购买受限", () => void openDemo("B"), "secondary", demoLoading))),
    h("section", { class: "panel stack" }, h("h3", null, "模拟不同研究表现与帮助"), h("p", { class: "hint" }, "固定相同案例与日程，比较独立完成、提示后完成和待核查三种模拟；不写入真实记录。"), button(judgeStudyLoading ? "正在准备对照…" : "生成研究对照", () => void compareJudgeStudy(), "small secondary", judgeStudyLoading), judgeStudy ? h("div", { class: "item-list" }, judgeStudy.map((item) => h("div", { class: "item" }, h("div", null, h("strong", null, item.label), h("p", null, `${item.status} · ${item.help}`), h("p", null, item.recommendation)), pill("模拟", "gold")))) : null),
    calibrationDemoUI.render(),
    h("section", { class: "panel stack" }, h("h3", null, "从关键选择前分叉"), h("p", { class: "hint" }, "选择一个检查点，回到当时的合法局面。分叉之后需要重新作选择，原记录不会覆盖。"), checkpoints.length ? h("div", { class: "item-list" }, checkpoints.map((cp) => h("div", { class: "item" }, h("div", null, h("strong", null, `${nodeNames[cp.snapshot.node]} · ${cp.action === "submit-entry" ? "契约参与" : cp.action === "submit-redemption" ? "回收选择" : "历史档案"}`), h("p", null, `当时可用 ${coins(cp.snapshot.wallet.cashCents)} 金币`)), button("从这里分叉", () => { try {
      const exposures = mergeFundingExposures(profile.funding_exposure, fundingExposureArchive.entries);
      const inheritedForecasts = cp.snapshot.node === "N4" || cp.snapshot.node === "N6" ? profile.forecasts.filter((forecast) => forecast.caseId === current.caseId && !forecast.withdrawn).map((forecast) => ({ ...forecast, priorExposure: true })) : [];
      const hadUnplacedForecast = !inheritedForecasts.length && profile.forecasts.some((forecast) => forecast.caseId === current.caseId && !forecast.withdrawn);
      cancelMarketRequest(); resetInitialCase(); resetGameUi(); run = forkRun(current, cp.id); priorExposure = true;
      profile = updateJourney({ ...emptyResearchProfile(current.observationEnabled, "fork"), funding_exposure: exposures, forecasts: inheritedForecasts }, run);
      selectedCard = null; changeScreen("game"); ensureInitialCase(); queueMarket();
      if (inheritedForecasts.length) flash("已保留原局事前预期作为模拟参考；分叉不作为可比的新观察。");
      else if (hadUnplacedForecast) flash("此分叉与原预期的先后无法确认，预期不会用于比较。");
    } catch (error) { flash(errorMessage(error)); } }, "small secondary")))) : h("p", { class: "hint" }, "当前记录还没有这些经营检查点。先继续旅程，或打开一条模拟路径。")),
    h("section", { class: "panel stack" }, h("h3", null, "局面、选择与依据"), h("div", { class: "timeline" }, current.history.filter((event) => event.type === "choice" || event.type === "market").slice().reverse().map((event) => h("div", { class: "timeline-item" }, h("strong", null, `${nodeNames[event.node]} · ${event.message}`), h("p", null, `依据 ${event.id}${event.snapshot ? ` · 当时可用 ${coins(event.snapshot.cashCents)} 金币` : ""}`)))), h("p", { class: "hint" }, `当前推荐：${profile.enabled ? recommendResearch(profile).reason : "观察未启用"}`)),
    profile.enabled ? preferencePanel() : null, h("div", { class: "button-row" }, button("回到旅程", () => changeScreen(current.phase === "ended" ? "report" : "game"), "secondary"))), h("aside", { class: "side-column" }, h("section", { class: "panel stack" }, h("h3", null, "分叉边界"), h("p", { class: "hint" }, "改变参与量或回收后，现金、可买项目和后续状态可能改变。分叉不会继承原来的后续感受和理由。")))));
}
function resetJudgeDemos(): void {
  demoVersion++; judgeStudyVersion++;
  demoLoading = false; judgeStudyLoading = false; judgeStudy = null;
  calibrationDemoUI.reset();
}
async function openDemo(path: "A" | "B"): Promise<void> {
  if (demoLoading) return;
  const version = ++demoVersion;
  demoLoading = true; render();
  try {
    const available = manifest ?? await loadMarketInitial();
    if (version !== demoVersion || screen !== "judge") return;
    manifest = available;
    const generated = await makeDemoPath(path, available.cases[0]!.caseId);
    if (version !== demoVersion || screen !== "judge") return;
    markExternalExposure(generated.caseId); cancelMarketRequest(); resetInitialCase(); resetGameUi();
    run = generated; profile = updateJourney({ ...emptyResearchProfile(true, "demo"), funding_exposure: structuredClone(fundingExposureArchive.entries) }, generated); priorExposure = true; changeScreen("judge"); ensureInitialCase();
    flash(`模拟路径${path === "A" ? "甲" : "乙"}已生成，可查看依据或从检查点分叉。`);
  } catch (error) { if (version === demoVersion && screen === "judge") flash(`生成模拟路径失败：${errorMessage(error)}`); }
  finally { if (version === demoVersion) { demoLoading = false; if (screen === "judge") render(); } }
}
async function compareJudgeStudy(): Promise<void> {
  if (judgeStudyLoading) return;
  const version = ++judgeStudyVersion;
  judgeStudyLoading = true; render();
  try {
    const available = manifest ?? await loadMarketInitial();
    if (version !== judgeStudyVersion || screen !== "judge") return;
    manifest = available;
    const caseId = available.cases.find((item) => item.caseId !== run?.caseId)?.caseId ?? available.cases[0]!.caseId;
    const schedule = { startingCashCents: 7200, participationCents: 2000, t1: 0 as const, t2: 0 as const };
    const instances = ["独立完成", "提示后完成", "结论待核查"].map((label) => {
      const id = uid("judge-study");
      const staged = startHistory(emptyResearchProfile(true, "demo"), { id, caseId, questionVersion: "d2-v1", schedule, initialClaim: "unknown", priorExposure: false });
      return { label, id, staged };
    });
    const data = await loadResearchCase(caseId, true);
    if (version !== judgeStudyVersion || screen !== "judge") return;
    const correct = compareSchedule(data, schedule).direction;
    judgeStudy = instances.map((item, index) => {
      let simulated = showHistoryEvidence(item.staged, item.id, data);
      if (index === 1) simulated = markHistoryHelp(simulated, item.id, "hint");
      const answer: Direction = index === 2 ? correct === "outperform" ? "underperform" : "outperform" : correct;
      const result = submitHistory(simulated, item.id, { comparison: answer, reason: "模拟：比较同口径数字" });
      return { label: item.label, status: result.profile.knowledge_observations.find((observation) => observation.dimension === "K1")?.text ?? "未观察", recommendation: result.recommendation.reason, help: result.recommendation.help === "self" ? "建议自主" : result.recommendation.help === "step" ? "建议分步" : "建议提示" };
    });
    markExternalExposure(caseId);
  } catch (error) { if (version === judgeStudyVersion && screen === "judge") flash(`研究对照加载失败：${errorMessage(error)}`); }
  finally { if (version === judgeStudyVersion) { judgeStudyLoading = false; if (screen === "judge") render(); } }
}
function revealResearchResult(task: "D1" | "D2"): void {
  if (screen !== task.toLowerCase() || modal) return;
  const result = app.querySelector<HTMLElement>(`#research-${task.toLowerCase()}-result`);
  if (!result || result.closest("[inert]")) return;
  result.focus({ preventScroll: true });
  result.scrollIntoView({ behavior: "auto", block: "start" });
}
function inspectLocalStorage(): StorageRead {
  try { return inspectAdventureStorage(window.localStorage); } catch { return { kind: "unavailable" }; }
}
function snapshotsEqual(first: StorageSnapshot, second: StorageSnapshot): boolean {
  return first.save === second.save && first.seen === second.seen && first.exposure === second.exposure;
}
function enterRecovery(read: StorageRead, backup?: StorageSnapshot | null, message: string | null = null, uncertain = false): void {
  cancelMarketRequest(); resetInitialCase(); resetGameUi();
  const current = read.kind === "unavailable" ? null : read.snapshot;
  recovery = { current, backup: backup ?? current, issues: read.kind === "recovery" ? read.issues : [], summary: uncertain ? null : read.kind === "ready" ? read.save : read.kind === "recovery" ? read.summary : null, unavailable: read.kind === "unavailable", uncertain, message };
  run = null; realSave = null; profile = emptyResearchProfile(false); screen = "intro"; modal = null;
}
/** Validate all three records before any migration, expiration or save. */
function restoreStoredState(read: StorageRead): void {
  resetGameUi();
  if (read.kind === "unavailable") { enterRecovery(read); return; }
  if (read.kind === "recovery") {
    const saved = read.summary;
    const expiredObservation = !!saved?.profile.enabled && !read.issues.includes("save-time") && Date.now() - saved.observationStartedAt > RETENTION_MS;
    const clearExposure = read.archiveExpired || (expiredObservation && !!read.archive);
    if (!expiredObservation && !clearExposure) { enterRecovery(read); return; }
    const cleaned = expiredObservation && saved ? { ...saved, run: { ...saved.run, observationEnabled: false }, profile: revokeResearch(saved.profile) } : null;
    let outcome: ReturnType<typeof expireAdventureStorage>;
    try { outcome = expireAdventureStorage(window.localStorage, read.snapshot, cleaned ? JSON.stringify(cleaned) : null, clearExposure); } catch { outcome = { status: "failed-restored", snapshot: read.snapshot }; }
    if (outcome.status === "saved") {
      const updated = inspectLocalStorage();
      if (updated.kind === "unavailable") enterRecovery(updated, null, "已处理可确认过期的观察，但暂时无法读取剩余记录，请重试。");
      else restoreStoredState(updated);
    } else {
      const message = outcome.status === "changed" ? "本机记录已变化，请重新读取后再继续。" : outcome.status === "failed-uncertain" ? "过期记录清理未完成，部分本机内容可能已变化；请下载当前可用的备份。" : "部分过期观察仍未清理；请检查存储设置后重试。";
      enterRecovery(inspectLocalStorage(), outcome.status === "changed" ? null : outcome.snapshot, message, outcome.status === "failed-uncertain");
    }
    return;
  }
  const now = Date.now(); const saved = read.save;
  const expiredObservation = !!saved?.profile.enabled && now - saved.observationStartedAt > RETENTION_MS;
  const expiredArchive = read.archiveExpired;
  let restored = saved ? { ...saved, run: structuredClone(saved.run), profile: structuredClone(saved.profile) } : null;
  if (restored && expiredObservation) {
    restored.profile = revokeResearch(restored.profile);
    restored.run.observationEnabled = false;
  } else if (restored?.profile.enabled) {
    restored.profile.funding_exposure = expiredArchive ? [] : mergeFundingExposures(restored.profile.funding_exposure, read.archive?.entries ?? []);
    restored.priorExposure = !!restored.priorExposure || expiredArchive;
  }
  if (expiredObservation || expiredArchive) {
    const cleanSave = restored && (expiredObservation || restored.profile.enabled) ? JSON.stringify(restored) : null;
    let outcome: ReturnType<typeof expireAdventureStorage>;
    try { outcome = expireAdventureStorage(window.localStorage, read.snapshot, cleanSave, true); } catch { outcome = { status: "failed-restored", snapshot: read.snapshot }; }
    if (outcome.status !== "saved") {
      const message = outcome.status === "changed" ? "本机记录已变化，请重新读取后再继续。" : outcome.status === "failed-uncertain" ? "过期记录清理未完成，部分本机内容可能已变化；请下载当前可用的备份。" : "部分过期观察仍未清理；请检查存储设置后重试。";
      enterRecovery(inspectLocalStorage(), outcome.status === "changed" ? null : outcome.snapshot, message, outcome.status === "failed-uncertain");
      return;
    }
  }
  recovery = null; storageError = false; seenCases = read.seen;
  fundingExposureArchive = expiredObservation || expiredArchive ? { version: 1, createdAt: now, entries: [] } : read.archive ?? { version: 1, createdAt: now, entries: [] };
  realSave = restored; run = restored?.run ?? null; profile = restored?.profile ?? emptyResearchProfile();
  observationStartedAt = restored?.observationStartedAt ?? now; priorExposure = !!restored?.priorExposure;
  tutorialStep = restored ? restoredTutorial(restored.run, restored.tutorialStep) : 4;
  if (restored?.profile.enabled) rememberFundingExposures(restored.profile);
}
function retryStoredState(): void {
  const previous = recovery; const read = inspectLocalStorage();
  if (previous?.uncertain && (read.kind === "unavailable" || !previous.backup || !snapshotsEqual(read.snapshot, previous.backup))) {
    enterRecovery(read, previous.backup, "上次替换未能完全恢复原记录。你仍可下载此前读取的备份；若要开始新旅程，请再次确认清除。", true);
  } else restoreStoredState(read);
  render(false);
  if (!recovery && run) ensureInitialCase();
}
function downloadRecoveryBackup(snapshot: StorageSnapshot): void {
  try {
    const url = URL.createObjectURL(new Blob([adventureBackup(snapshot)], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "nextcard-adventure-local-backup.json"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    modal = null; flash("已发起本地备份下载，请检查浏览器下载列表。");
  } catch { flash("无法发起下载，请检查浏览器设置后重试。"); }
}
function askRecoveryReplacement(enabled: boolean): void {
  if (!recovery?.current || !manifest?.cases.length) return;
  showDialog("清除现有冒险与观察？", h("p", { class: "hint" }, "确认后会清除这台设备的 v0.4 冒险、观察与辅助记录，并开始新旅程。原记录将不能在这里恢复；建议先下载备份。旧版 v0.3 不受影响。"),
    [button("确认清除并开始", () => replaceRecoveredRun(enabled), "danger"), button("保留现有记录", closeDialog, "secondary")]);
}
function replaceRecoveredRun(enabled: boolean): void {
  const state = recovery; if (!state?.current || !manifest?.cases.length) return;
  const now = Date.now(); const chosen = chooseAdventureCase(manifest.cases.map((item) => item.caseId), new Set());
  const nextRun = createRun({ caseId: chosen.caseId, observationEnabled: enabled, source: "real", seed: independentBattleSeed() });
  const nextProfile = emptyResearchProfile(enabled);
  const nextSave: Save = { schema: "nextcard-adventure-save-v1", savedAt: now, observationStartedAt: now, priorExposure: false, tutorialStep: 0, run: nextRun, profile: nextProfile };
  let outcome: ReturnType<typeof replaceAdventureStorage>;
  try { outcome = replaceAdventureStorage(window.localStorage, state.current, JSON.stringify(nextSave)); } catch { outcome = "failed-restored"; }
  if (outcome !== "saved") {
    const message = outcome === "changed" ? "本机记录已变化，请重新读取后再确认。" : outcome === "failed-uncertain" ? "替换未完成，原记录也未能完全恢复；部分本机内容可能已变化。请先下载此前读取的备份。" : "未能保存新旅程，原记录已保留；请检查存储设置后重试。";
    enterRecovery(inspectLocalStorage(), state.backup, message, state.uncertain || outcome === "failed-uncertain");
    render(); return;
  }
  recovery = null; storageError = false; cancelMarketRequest(); resetInitialCase(); resetJudgeDemos();
  run = nextRun; realSave = nextSave; profile = nextProfile; seenCases = new Set(); fundingExposureArchive = { version: 1, createdAt: now, entries: [] };
  resetGameUi(); observationStartedAt = now; priorExposure = false; tutorialStep = 0; entryCents = 0; reserveCents = 0; modal = null;
  changeScreen("game"); ensureInitialCase();
}
function recoveryView(): HTMLElement {
  const state = recovery!;
  const descriptions: Record<RecoveryIssue, string> = { "save-invalid": "冒险记录内容不完整，暂时无法安全继续。", "save-unsupported": "这份冒险记录使用了当前版本不支持的格式。", "save-time": "记录时间无法核验，暂时不能安全处理观察期限。", "seen-invalid": "已接触案例的记录无法核验。", "exposure-invalid": "研究提示或答案的记录无法核验。", "exposure-unsupported": "研究提示或答案的记录版本暂不受支持。" };
  const saved = state.summary; const savedDate = saved ? new Date(saved.savedAt) : null;
  const time = savedDate && Number.isFinite(savedDate.getTime()) ? savedDate.toLocaleString("zh-CN") : "时间无法确认";
  return h("div", { class: "app-shell" }, topbar(), h("main", { class: "panel stack", id: "main-content", style: "max-width:760px;margin:30px auto" },
    h("div", { class: "panel-head" }, h("div", null, h("h1", null, "本地记录需要处理"), h("p", { class: "hint" }, "当前没有继续旧旅程，也不会自动替换原记录。"))),
    state.unavailable ? h("p", { class: "hint" }, "浏览器暂时无法读取本地记录；请检查存储设置后重试。") : state.issues.map((issue) => h("p", { class: "hint" }, descriptions[issue])),
    state.message ? h("div", { class: "notice error", role: "status" }, state.message) : null,
    saved ? h("div", { class: "notice" }, h("strong", null, "可辨认的旧旅程"), h("p", null, `${nodeNames[saved.run.node]} · 生命 ${saved.run.hp}/${saved.run.maxHp} · 可用 ${coins(saved.run.wallet.cashCents)} 金币`), h("p", null, `保存时间：${time}。这里只供回顾，不会继续或生成观察。`)) : null,
    h("p", { class: "fineprint" }, "无法解析的记录期限可能无法核验，不会作为有效观察。备份可能包含你的预期、感受和研究记录；下载后的文件由你保管。"),
    h("div", { class: "button-row" }, button("重试读取本地记录", retryStoredState, "secondary", false, "retry-storage"), button("下载本地备份", () => { const backup = recovery?.backup; if (backup) downloadRecoveryBackup(backup); }, "secondary", !state.backup, "backup-storage")),
    h("div", { class: "button-row" }, button("清除现有冒险与观察，开始新旅程", () => askRecoveryReplacement(true), "gold", !state.current || !manifest?.cases.length, "replace-storage"), button("清除后只玩游戏", () => askRecoveryReplacement(false), "secondary", !state.current || !manifest?.cases.length, "replace-storage-game")),
    initialError ? h("p", { class: "hint" }, "案例目录暂时未加载。", button("重试数据", loadInitial, "small secondary", initialLoading)) : null));
}
const researchUI = new ResearchUI({ getRun: () => run!, getProfile: () => profile, setProfile, getManifest: () => manifest, retryManifest: loadInitial, manifestLoading: () => initialLoading, manifestError: () => initialError, back: () => changeScreen(run?.phase === "ended" ? "report" : "game"), openTask: (task) => changeScreen(task === "D1" ? "d1" : "d2"), refresh: () => render(), revealResult: revealResearchResult, notify: flash, uid, isCaseKnown: (caseId) => !!run && casesAreRelated(caseId, run.caseId) && priorExposure, wasCaseSeen: (caseId) => hasSeenRelatedCase(seenCases, caseId), markCaseSeen: markExternalExposure });
const calibrationDemoUI = new CalibrationDemoUI({ refresh: () => render(), isVisible: () => screen === "judge", onExposed: markExternalExposure });
function render(preserve = true): void {
  const active = preserve ? (document.activeElement as HTMLElement | null)?.dataset.focusKey : undefined;
  const open = preserve ? [...app.querySelectorAll("details[open] > summary")].map((element) => element.textContent ?? "") : [];
  const scrollPositions = preserve ? [...app.querySelectorAll<HTMLElement>("[data-scroll-key]")].map((element) => [element.dataset.scrollKey!, element.scrollLeft] as const) : [];
  const scroll = window.scrollY;
  let content: HTMLElement;
  if (recovery) content = recoveryView();
  else if (screen === "intro" || !run) content = intro();
  else if (screen === "report") content = report();
  else if (screen === "judge") content = judge();
  else if (screen === "d1" || screen === "d2") content = h("div", { class: "app-shell" }, topbar(), screen === "d1" ? researchUI.renderFunding() : researchUI.renderHistory());
  else content = h("div", null, h("div", { class: "app-shell" }, topbar()), gameView({ run, initialCase, initialCaseError, initialCaseLoading, retryInitialCase, selectedCard, selectedRetain, selectedUpgrade, selectedReward, entryCents, reserveCents, marketLoading, marketError, battleFeedback, gameFeedback, tutorialStep, action, selectCard: (id) => { selectedCard = id; if (id && run?.node === "N1" && tutorialStep < 2) { tutorialStep = 2; save(); } render(); }, selectRetain: (id) => { selectedRetain = id; render(); }, selectUpgrade: (id) => { selectedUpgrade = id; render(); }, selectReward, setEntry: (amount, redraw) => { entryCents = amount; if (redraw) render(); }, setReserve: (amount) => { reserveCents = amount; }, retryMarket, extraCamp: () => researchUI.campExtras(), openReport: () => changeScreen("report"), openTask: (task) => changeScreen(task), archiveShown: (caseId) => { if (run?.source === "real") markNaturalArchiveSeen(caseId); else markExternalExposure(caseId); }, nextTutorial: () => setTutorialStep(tutorialStep + 1), skipTutorial: () => setTutorialStep(4), openPile, openEnemyPlan }));
  content.inert = !!modal;
  const wrapper = h("div", { class: `adventure${screen === "game" && run?.phase === "battle" ? " battle-active" : ""}` }, content, storageError ? h("div", { class: "toast", role: "status" }, "浏览器无法保存进度，请检查本地存储设置。") : null, toastMessage ? h("div", { class: "toast", role: "status" }, toastMessage) : null, modal);
  app.replaceChildren(wrapper);
  for (const summary of app.querySelectorAll<HTMLElement>("details > summary")) if (open.includes(summary.textContent ?? "")) (summary.parentElement as HTMLDetailsElement).open = true;
  for (const [key, left] of scrollPositions) { const element = app.querySelector<HTMLElement>(`[data-scroll-key="${CSS.escape(key)}"]`); if (element) element.scrollLeft = left; }
  if (preserve) { if (active) { const target = (modal ?? app).querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(active)}"]`); if (target && !(target instanceof HTMLButtonElement && target.disabled)) target.focus({ preventScroll: true }); else if (active.startsWith("play-card") || active.startsWith("tutorial-")) { const hand = app.querySelector<HTMLElement>('.battle-hand-panel [data-scroll-key="battle-hand"]'); const box = hand?.getBoundingClientRect(); const visible = [...(hand?.querySelectorAll<HTMLElement>(".game-card") ?? [])].find((card) => { const rect = card.getBoundingClientRect(); return !!box && rect.right > box.left && rect.left < box.right; }); (visible ?? hand)?.focus({ preventScroll: true }); } } window.scrollTo(0, scroll); }
}
restoreStoredState(inspectLocalStorage());
render(false);
loadInitial();
if (run) ensureInitialCase();
