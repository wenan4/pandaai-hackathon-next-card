import { h } from "../ui/dom";
import { battleIntentForecast, enemyPattern } from "./enemy-information";
import type { EnemyId, Intent, Run } from "./types";

export function intentText(intent: Intent): string {
  return intent.kind === "attack" ? `攻击 ${intent.amount}` : `获得护盾 ${intent.amount}`;
}

/** Public starting sequence; this is not a prediction of the player's choices. */
export function routeEnemySummary(enemyId: EnemyId): HTMLElement {
  const enemy = enemyPattern(enemyId);
  const opening = enemy.cycle.length ? Array.from({ length: 3 }, (_, index) => intentText(enemy.cycle[index % enemy.cycle.length]!)).join(" → ") : "暂无节奏信息";
  return h("div", { class: "route-enemy-summary" }, h("p", null, `生命 ${enemy.maxHp}`), h("p", null, h("strong", null, "开局三回合结束："), opening));
}

/** Only the public fixed plan; opening this view does not advance the battle. */
export function enemyPlanView(run: Run): HTMLElement {
  const forecast = battleIntentForecast(run);
  if (!forecast) return h("div", { class: "enemy-plan" }, h("p", { class: "hint" }, "当前节奏暂不可用；请以战斗画面中的实际意图为准。"));
  const enemy = enemyPattern(forecast.enemyId);
  const labels = { "this-turn": "本回合结束", "next-turn": "下回合结束", "following-turn": "再下一回合结束" } as const;
  return h("div", { class: "enemy-plan" }, h("p", { class: "hint" }, `${enemy.name}的固定节奏。你先出牌；若战斗继续，后两步才会发生。`),
    h("ol", { class: "enemy-plan-list" }, forecast.actions.map((action) => h("li", null, h("div", null, h("strong", null, labels[action.timing]), h("span", null, `第 ${action.turn} 回合`)), h("b", null, intentText(action.intent))))),
    h("p", { class: "hint" }, enemy.attackGrowth ? `第 ${enemy.attackGrowth.fromTurn} 个敌方阶段起，每阶段累计 ${enemy.attackGrowth.perTurn} 点攻击加成；护盾数值不增加。` : "此对手的攻击不会随回合增加。"),
    h("p", { class: "fineprint" }, "攻击会先由护盾抵挡；若对手先被击败，其尚未执行的行动会取消。"));
}
