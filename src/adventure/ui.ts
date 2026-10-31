import "./adventure.css";
import { h, type Child } from "../ui/dom";
import { createRun, forkRun, pendingMarketStep, reduceRun } from "./engine";
import { CARDS, ENEMIES } from "./content";
import { loadMarketInitial, loadMarketInitialCase, loadMarketStage, loadResearchCase, type MarketInitialCase, type MarketManifest } from "./market";
import { addUserReason, compareSchedule, compareSelfForecast, declarePriorExposure, emptyResearchProfile, markHistoryHelp, recommendResearch, revokeResearch, setHelpPreference, setResearchGoal, showHistoryEvidence, startHistory, submitHistory, updateJourney, type Direction, type Goal, type HelpPreference, type ResearchProfile } from "./research";
import type { Run, RunAction } from "./types";
import { button, coins, dateText, pill } from "./ui-components";
import { gameView, nodeNames } from "./ui-game";
import { ResearchUI } from "./ui-research";
import { makeDemoPath } from "./ui-demo";
import { mergeFundingExposures, parseFundingExposureArchive, type FundingExposureArchive } from "./ui-exposure";
import { reportView } from "./ui-report";
import { casesAreRelated, chooseAdventureCase, hasSeenRelatedCase, independentBattleSeed } from "./ui-case";
import { CalibrationDemoUI } from "./ui-calibration-demo";
import { dataInfoContent } from "./ui-data-info";
import { pileView, type PileKind } from "./ui-piles";

const app = document.querySelector<HTMLDivElement>("#app")!;
const SAVE_KEY = "nextcard:adventure:v0.4";
const SEEN_KEY = `${SAVE_KEY}:seen-cases`;
const FUNDING_EXPOSURE_KEY = `${SAVE_KEY}:funding-exposure`;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
type Screen = "intro" | "game" | "report" | "d1" | "d2" | "judge";
interface Save { schema: "nextcard-adventure-save-v1"; savedAt: number; observationStartedAt: number; priorExposure?: boolean; tutorialStep?: number; run: Run; profile: ResearchProfile }
let run: Run | null = null;
let profile: ResearchProfile = emptyResearchProfile();
let realSave: Save | null = null;
let observationStartedAt = Date.now();
let priorExposure = false;
let seenCases = new Set<string>();
let fundingExposureArchive: FundingExposureArchive = { version: 1, createdAt: Date.now(), entries: [] };
let fundingArchiveExpired = false;
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
let battleFeedback = "";
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

function readSave(): Save | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY); if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const saved = data as Partial<Save>;
    if (saved.schema !== "nextcard-adventure-save-v1" || saved.run?.version !== "0.4.1" || saved.profile?.version !== "research-v1" || typeof saved.observationStartedAt !== "number" || typeof saved.savedAt !== "number") return null;
    if (!Array.isArray(saved.profile.funding_exposure)) saved.profile.funding_exposure = [];
    if (!saved.profile.source) saved.profile.source = saved.run.source;
    if (Date.now() - saved.observationStartedAt > RETENTION_MS && saved.profile.enabled) {
      saved.profile = revokeResearch(saved.profile);
      saved.run.observationEnabled = false;
      clearFundingExposures();
    }
    return saved as Save;
  } catch { storageError = true; return null; }
}
function save(): boolean {
  if (!run || run.source !== "real") return true;
  const data: Save = { schema: "nextcard-adventure-save-v1", savedAt: Date.now(), observationStartedAt, priorExposure, tutorialStep, run, profile };
  realSave = data;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); return true; } catch { storageError = true; return false; }
}
function rememberFundingExposures(next: ResearchProfile): void {
  if (run?.source !== "real" || !next.enabled || !next.funding_exposure.length) return;
  if (Date.now() - fundingExposureArchive.createdAt >= RETENTION_MS) fundingExposureArchive = { version: 1, createdAt: Date.now(), entries: [] };
  if (!fundingExposureArchive.entries.length) fundingExposureArchive.createdAt = Date.now();
  fundingExposureArchive.entries = mergeFundingExposures(fundingExposureArchive.entries, next.funding_exposure);
  try { localStorage.setItem(FUNDING_EXPOSURE_KEY, JSON.stringify(fundingExposureArchive)); } catch { storageError = true; }
}
function clearFundingExposures(): boolean {
  try { localStorage.removeItem(FUNDING_EXPOSURE_KEY); } catch { storageError = true; return false; }
  fundingExposureArchive = { version: 1, createdAt: Date.now(), entries: [] };
  return true;
}
function setProfile(next: ResearchProfile): void { profile = next; rememberFundingExposures(profile); save(); render(); }
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
  if (realSave) {
    showDialog("开启新的旅程？", h("p", { class: "hint" }, "已保存的真实冒险进度会被新旅程替换。"), [button("开始新旅程", () => { modal = null; startRun(enabled); }, "gold"), button("保留已有旅程", closeDialog, "secondary")]);
  } else startRun(enabled);
}
function cancelMarketRequest(): void { requestVersion++; marketLoading = false; marketError = null; }
function resetInitialCase(): void { initialCaseVersion++; initialCase = null; initialCaseLoading = false; initialCaseError = null; }
/** Called only after a run has fixed its case; it never fetches other cases' histories. */
function ensureInitialCase(): void {
  if (!run || initialCaseLoading || initialCaseError || initialCase?.caseId === run.caseId) return;
  const caseId = run.caseId; const runId = run.id; const version = ++initialCaseVersion;
  initialCaseLoading = true; render();
  void loadMarketInitialCase(caseId, true).then((data) => {
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
  seenCases.add(caseId);
  if (realSave && casesAreRelated(realSave.run.caseId, caseId)) {
    realSave = { ...realSave, priorExposure: true, profile: invalidatePending ? invalidatePendingComparison(realSave.profile, caseId) : realSave.profile };
    if (run?.source === "real" && run.id === realSave.run.id) { priorExposure = true; profile = realSave.profile; }
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(realSave)); } catch { storageError = true; }
  }
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seenCases])); } catch { storageError = true; }
}
/** Showing this run's own T0 history affects later replays, not its current forecast. */
function markNaturalArchiveSeen(caseId: string): void {
  if (seenCases.has(caseId)) return;
  seenCases.add(caseId);
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seenCases])); } catch { storageError = true; }
}
function startRun(enabled: boolean): void {
  if (!manifest?.cases.length) { flash("案例目录尚未准备好，请重试加载。"); if (!initialLoading) loadInitial(); return; }
  cancelMarketRequest(); resetInitialCase();
  const chosen = chooseAdventureCase(manifest.cases.map((item) => item.caseId), seenCases);
  priorExposure = chosen.priorExposure;
  run = createRun({ caseId: chosen.caseId, observationEnabled: enabled, source: "real", seed: independentBattleSeed() });
  if (Date.now() - fundingExposureArchive.createdAt >= RETENTION_MS && !clearFundingExposures()) fundingExposureArchive = { version: 1, createdAt: Date.now(), entries: [] };
  profile = { ...emptyResearchProfile(enabled), funding_exposure: enabled ? structuredClone(fundingExposureArchive.entries) : [] }; observationStartedAt = Date.now(); selectedCard = null; selectedUpgrade = null; battleFeedback = ""; tutorialStep = 0; entryCents = 0; reserveCents = 0;
  save(); changeScreen("game"); ensureInitialCase();
}
function action(next: RunAction): void {
  if (!run) return;
  const previousPhase = run.phase; const previousNode = run.node;
  const before = run;
  try {
    run = reduceRun(run, next);
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
      seenCases.add(run.caseId); try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seenCases])); } catch { storageError = true; }
    }
    if (profile.enabled) profile = updateJourney(profile, run);
    if (next.type === "play-card" || next.type === "end-turn") { selectedCard = null; selectedRetain = null; }
    if (next.type === "purchase-attempted") flash("可用金币不足，这次购买没有完成。");
    save();
    if (run.phase === "ended") screen = "report";
    const changed = previousPhase !== run.phase || previousNode !== run.node;
    render(!changed);
    if (changed) window.scrollTo({ top: 0, behavior: "auto" });
    queueMarket();
  } catch (error) { flash(errorMessage(error)); }
}
function queueMarket(): void {
  if (!run || run.phase !== "market" || marketLoading || marketError) return;
  const pending = pendingMarketStep(run); if (!pending) return;
  const capturedRun = run; const version = ++requestVersion; marketLoading = true; render();
  void loadMarketStage(pending.caseId, pending.stage, pending.unlocked).then((quote) => {
    if (version !== requestVersion || run !== capturedRun) return;
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
  cancelMarketRequest(); resetInitialCase();
  run = structuredClone(realSave.run); profile = structuredClone(realSave.profile); if (profile.enabled) profile.funding_exposure = mergeFundingExposures(profile.funding_exposure, fundingExposureArchive.entries); observationStartedAt = realSave.observationStartedAt; priorExposure = realSave.priorExposure ?? false; tutorialStep = restoredTutorial(run, realSave.tutorialStep);
  changeScreen(run.phase === "ended" ? "report" : "game"); ensureInitialCase(); queueMarket();
}
function settings(): void {
  const state = run?.observationEnabled && profile.enabled;
  const touchedCases = new Set<string>();
  if (run) touchedCases.add(run.caseId);
  for (const attempt of profile.research_process) { if (attempt.shown) { touchedCases.add(attempt.caseId); if (attempt.shown.other) touchedCases.add(attempt.shown.other.caseId); } }
  for (const attempt of profile.funding_attempts) if (attempt.caseId !== "manual-example") touchedCases.add(attempt.caseId);
  const caseLabel = (caseId: string): string => { const item = manifest?.cases.find((entry) => entry.caseId === caseId); return `${caseId === run?.caseId ? "本局" : "历史片段"} · ${item ? `${item.name} · ${dateText(item.decisionDate)}` : caseId}`; };
  const selectedCase = h("select", { "aria-label": "选择要补充的案例" }, [...touchedCases].map((caseId) => h("option", { value: caseId, selected: caseId === run?.caseId }, caseLabel(caseId))));
  const body = h("div", { class: "stack" }, h("p", { class: "hint" }, "进度保存在这台设备的浏览器中，不会默认上传。观察从开启起最多保存 30 天，过期后移除观察并保留游戏进度。"),
    h("p", { class: "hint" }, state ? "当前：生成本局观察。" : "当前：只玩游戏，不保存观察。"),
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
    button("清除全部本地记录", () => showDialog("清除这台设备的冒险记录？", h("p", { class: "hint" }, "当前冒险与本局观察会删除，此操作无法撤销。旧版 v0.3 存档不受影响。"), [button("确认清除", () => { try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(SEEN_KEY); localStorage.removeItem(FUNDING_EXPOSURE_KEY); } catch { storageError = true; flash("未能清除浏览器本地记录，请检查存储设置后重试。"); return; } fundingExposureArchive = { version: 1, createdAt: Date.now(), entries: [] }; seenCases.clear(); cancelMarketRequest(); resetInitialCase(); resetJudgeDemos(); run = null; realSave = null; profile = emptyResearchProfile(); modal = null; changeScreen("intro"); flash("本地冒险记录已清除。"); }, "danger"), button("返回", closeDialog, "secondary")]), "danger"));
  showDialog("旅程与隐私设置", body, [button("完成", closeDialog, "secondary")]);
}
function dataInfo(): void {
  showDialog("关于这段历史", dataInfoContent(manifest, run), [button("知道了", closeDialog, "secondary")]);
}
function openPile(pile: PileKind): void {
  if (!run?.battle || run.phase !== "battle") return;
  showDialog("查看牌组", pileView(run, pile), [button("返回战斗", closeDialog, "secondary")]);
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
  return reportView({ run: run!, profile, header: topbar(), preferences: profile.enabled ? preferencePanel() : null, calibration: profile.enabled ? researchUI.calibrationReport() : null,
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
      cancelMarketRequest(); resetInitialCase(); run = forkRun(current, cp.id); priorExposure = true;
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
    markExternalExposure(generated.caseId); cancelMarketRequest(); resetInitialCase();
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
const researchUI = new ResearchUI({ getRun: () => run!, getProfile: () => profile, setProfile, getManifest: () => manifest, back: () => changeScreen(run?.phase === "ended" ? "report" : "game"), openTask: (task) => changeScreen(task === "D1" ? "d1" : "d2"), refresh: () => render(), notify: flash, uid, isCaseKnown: (caseId) => !!run && casesAreRelated(caseId, run.caseId) && priorExposure, wasCaseSeen: (caseId) => hasSeenRelatedCase(seenCases, caseId), markCaseSeen: markExternalExposure });
const calibrationDemoUI = new CalibrationDemoUI({ refresh: () => render(), isVisible: () => screen === "judge", onExposed: markExternalExposure });
function render(preserve = true): void {
  const active = preserve ? (document.activeElement as HTMLElement | null)?.dataset.focusKey : undefined;
  const open = preserve ? [...app.querySelectorAll("details[open] > summary")].map((element) => element.textContent ?? "") : [];
  const scrollPositions = preserve ? [...app.querySelectorAll<HTMLElement>("[data-scroll-key]")].map((element) => [element.dataset.scrollKey!, element.scrollLeft] as const) : [];
  const scroll = window.scrollY;
  let content: HTMLElement;
  if (screen === "intro" || !run) content = intro();
  else if (screen === "report") content = report();
  else if (screen === "judge") content = judge();
  else if (screen === "d1" || screen === "d2") content = h("div", { class: "app-shell" }, topbar(), screen === "d1" ? researchUI.renderFunding() : researchUI.renderHistory());
  else content = h("div", null, h("div", { class: "app-shell" }, topbar()), gameView({ run, initialCase, initialCaseError, initialCaseLoading, retryInitialCase, selectedCard, selectedRetain, selectedUpgrade, entryCents, reserveCents, marketLoading, marketError, battleFeedback, tutorialStep, action, selectCard: (id) => { selectedCard = id; if (id && run?.node === "N1" && tutorialStep < 2) { tutorialStep = 2; save(); } render(); }, selectRetain: (id) => { selectedRetain = id; render(); }, selectUpgrade: (id) => { selectedUpgrade = id; render(); }, setEntry: (amount, redraw) => { entryCents = amount; if (redraw) render(); }, setReserve: (amount) => { reserveCents = amount; }, retryMarket, extraCamp: () => researchUI.campExtras(), openReport: () => changeScreen("report"), openTask: (task) => changeScreen(task), archiveShown: (caseId) => { if (run?.source === "real") markNaturalArchiveSeen(caseId); else markExternalExposure(caseId); }, nextTutorial: () => setTutorialStep(tutorialStep + 1), skipTutorial: () => setTutorialStep(4), openPile }));
  content.inert = !!modal;
  const wrapper = h("div", { class: `adventure${screen === "game" && run?.phase === "battle" ? " battle-active" : ""}` }, content, storageError ? h("div", { class: "toast", role: "status" }, "浏览器无法保存进度，请检查本地存储设置。") : null, toastMessage ? h("div", { class: "toast", role: "status" }, toastMessage) : null, modal);
  app.replaceChildren(wrapper);
  for (const summary of app.querySelectorAll<HTMLElement>("details > summary")) if (open.includes(summary.textContent ?? "")) (summary.parentElement as HTMLDetailsElement).open = true;
  for (const [key, left] of scrollPositions) { const element = app.querySelector<HTMLElement>(`[data-scroll-key="${CSS.escape(key)}"]`); if (element) element.scrollLeft = left; }
  if (preserve) { if (active) { const target = (modal ?? app).querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(active)}"]`); if (target && !(target instanceof HTMLButtonElement && target.disabled)) target.focus({ preventScroll: true }); else if (active.startsWith("play-card") || active.startsWith("tutorial-")) { const hand = app.querySelector<HTMLElement>('.battle-hand-panel [data-scroll-key="battle-hand"]'); const box = hand?.getBoundingClientRect(); const visible = [...(hand?.querySelectorAll<HTMLElement>(".game-card") ?? [])].find((card) => { const rect = card.getBoundingClientRect(); return !!box && rect.right > box.left && rect.left < box.right; }); (visible ?? hand)?.focus({ preventScroll: true }); } } window.scrollTo(0, scroll); }
}
try { const value: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"); if (Array.isArray(value)) seenCases = new Set(value.filter((item): item is string => typeof item === "string")); } catch { storageError = true; }
try {
  const raw = localStorage.getItem(FUNDING_EXPOSURE_KEY);
  const archive = parseFundingExposureArchive(raw, Date.now(), RETENTION_MS);
  if (raw && !archive) { localStorage.removeItem(FUNDING_EXPOSURE_KEY); fundingArchiveExpired = true; }
  fundingExposureArchive = archive ?? { version: 1, createdAt: Date.now(), entries: [] };
} catch { storageError = true; }
realSave = readSave();
if (realSave) { run = realSave.run; profile = realSave.profile; if (profile.enabled) { profile.funding_exposure = fundingArchiveExpired ? [] : mergeFundingExposures(profile.funding_exposure, fundingExposureArchive.entries); rememberFundingExposures(profile); } observationStartedAt = realSave.observationStartedAt; priorExposure = !!realSave.priorExposure || (fundingArchiveExpired && profile.enabled); tutorialStep = restoredTutorial(run, realSave.tutorialStep); save(); }
render(false);
loadInitial();
if (run) ensureInitialCase();
