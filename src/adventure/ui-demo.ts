import { canPlayCard, createRun, pendingMarketStep, reduceRun } from "./engine";
import { loadMarketStage } from "./market";
import type { CardId, CardInstance, Run } from "./types";

/** Simulated paths are generated with the same public actions and stage loaders as play. */
export async function makeDemoPath(path: "A" | "B", caseId: string): Promise<Run> {
  let run = createRun({ seed: 104, caseId, source: "demo", observationEnabled: true });
  let entryDone = false; let triedUpgrade = false; let upgraded = false;
  for (let n = 0; n < 800 && run.phase !== "ended"; n++) {
    if (run.phase === "market") {
      const pending = pendingMarketStep(run); if (!pending) throw new Error("缺少已解锁的行情阶段");
      const quote = await loadMarketStage(pending.caseId, pending.stage, pending.unlocked);
      run = reduceRun(run, { type: "apply-quote", quote }); continue;
    }
    if (run.phase === "reward") {
      const cardId: CardId = run.node === "N1" ? "C07" : run.node === "N3" ? "C08" : "C09";
      run = reduceRun(run, { type: "choose-reward", cardId }); continue;
    }
    if (run.phase === "camp") {
      if (run.node === "N2") {
        if (!entryDone) {
          if (path === "A") { run = reduceRun(run, { type: "buy-archive" }); run = reduceRun(run, { type: "open-archive" }); }
          run = reduceRun(run, { type: "submit-entry", amountCents: path === "A" ? 2000 : 6500 }); entryDone = true;
        }
        run = reduceRun(run, { type: "continue" }); continue;
      }
      if (run.camp!.decision === "not-submitted") { run = reduceRun(run, { type: "submit-redemption", percent: run.node === "N4" ? 50 : 0 }); continue; }
      if (!run.camp!.freeChoiceUsed) { run = reduceRun(run, { type: "free-rest" }); continue; }
      if (run.hp <= 31 && run.wallet.cashCents >= 1000) { run = reduceRun(run, { type: "heal" }); continue; }
      const card = run.deck.find((item) => item.cardId === "C07" && !item.upgraded);
      if (card && !upgraded && run.wallet.cashCents >= 2000) { run = reduceRun(run, { type: "upgrade-card", cardInstanceId: card.instanceId }); upgraded = true; continue; }
      run = reduceRun(run, { type: "continue" }); continue;
    }
    if (run.phase === "route") {
      if (path === "B" && run.node === "N3" && !triedUpgrade && run.wallet.cashCents < 2000) {
        const card = run.deck.find((item) => item.cardId === "C07" && !item.upgraded);
        if (card) run = reduceRun(run, { type: "purchase-attempted", purchase: "upgrade-card", cardInstanceId: card.instanceId });
        triedUpgrade = true; continue;
      }
      if (run.hp <= 30 && run.wallet.cashCents >= 1000) { run = reduceRun(run, { type: "heal" }); continue; }
      run = reduceRun(run, { type: "choose-route", enemyId: "moss" }); continue;
    }
    if (run.phase !== "battle" || !run.battle) throw new Error("模拟遇到未知状态");
    const b = run.battle;
    const hand = b.hand.map((id) => run.deck.find((card) => card.instanceId === id)).filter((card): card is CardInstance => !!card);
    const eligible = hand.filter((card) => canPlayCard(run, card.instanceId).enabled);
    const damage = (id: CardId): number => id === "C01" ? 6 : id === "C07" ? 9 : id === "C09" ? 12 : id === "C12" ? 26 : id === "C13" ? 14 : 0;
    let selected = eligible.find((card) => damage(card.cardId) > 0 && damage(card.cardId) + (card.cardId === "C07" ? 3 : 1) * b.attackBonus >= b.enemy.hp + b.enemy.shield);
    const c = (id: CardId): CardInstance | undefined => eligible.find((card) => card.cardId === id);
    if (!selected && c("C04") && b.energy <= 2 && hand.some((card) => card.cardId !== "C04")) selected = c("C04");
    if (!selected && b.turn <= 2 && b.enemy.hp > 24 && b.energy >= 2 && run.hp > 12) selected = c("C11") ?? c("C05");
    if (!selected && c("C08") && c("C07") && b.energy >= 2) selected = c("C08");
    const incoming = b.enemy.intent.kind === "attack" ? b.enemy.intent.amount : 0;
    if (!selected && incoming - b.shield >= 4) selected = c("C10") ?? c("C02") ?? c("C06");
    if (!selected && c("C03") && b.energy >= 2 && b.hand.length <= 5) selected = c("C03");
    if (!selected && c("C14")) selected = c("C14");
    if (!selected) selected = c("C12") ?? c("C13") ?? c("C09") ?? c("C07") ?? c("C01") ?? c("C06") ?? c("C02") ?? c("C03");
    if (selected) {
      const other = b.hand.find((id) => id !== selected!.instanceId);
      run = reduceRun(run, { type: "play-card", cardInstanceId: selected.instanceId, ...(selected.cardId === "C14" && other ? { retainCardId: other } : {}) });
    } else run = reduceRun(run, { type: "end-turn" });
  }
  if (run.phase !== "ended") throw new Error("模拟没有在规定步数内结束");
  return run;
}
