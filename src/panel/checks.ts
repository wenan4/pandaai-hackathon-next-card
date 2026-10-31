// PRD v0.3 §9 的 9 项反例检查（YOU-161）。评委面板的“一键运行”和 Vitest 用同一份实现；
// 每项都通过同一个 evaluate / recommend 重算，只改一个变量，再比较输出。
import { AVAILABLE_TOPICS, ENGINE_CONFIG } from "../config/engine";
import { ROUNDS } from "../config/rounds";
import { evaluateView as realEvaluate } from "../engine/evaluate";
import { eventFactory, eventsFromSpecs, type RoundSpec } from "../engine/paths";
import { recommendView as realRecommend } from "../engine/recommend";
import { flipOutcomes, settle } from "../engine/settle";
import type { Action, Card, GameEvent, Verdict } from "../engine/types";

export interface Engine {
  evaluate: typeof realEvaluate;
  recommend: typeof realRecommend;
}
export interface CheckResult {
  id: number;
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
}

const CHECK_TASKS = { "A:1": {content_id: "check-A1", answer: "outperform", actions: ["aligned"]}, "A:2": {content_id: "check-A2", answer: "supports", actions: ["window_extended"]} } as import("../engine/taskRules").TaskRules;
const REAL: Engine = { evaluate: realEvaluate, recommend: realRecommend };
const VERDICT_FLIP: Record<Verdict, Verdict> = { supports: "refutes", refutes: "supports", insufficient: "refutes" };

function run(engine: Engine, events: readonly GameEvent[]) {
  const out = engine.evaluate(events, { ...ENGINE_CONFIG, tasks: { ...CHECK_TASKS, ...ENGINE_CONFIG.tasks } });
  return { ...out, plan: engine.recommend(out.profile, out.progress, AVAILABLE_TOPICS) };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const planText = (p: ReturnType<typeof run>["plan"]) => `${p.route} · 任务 ${p.task}${p.task === "A" ? ` 步骤 ${p.steps.join("、")}` : ""}`;

/** 任务 A 两步都在提示下完成（先看提示、再切到“我自己来”、再提交）。 */
function hintedTaskA(start: number, steps: number[] = [1, 2], switchToSolo = false): GameEvent[] {
  const ev = eventFactory("check", "v0.3", start);
  return steps.flatMap((step) => [
    ev("taskA", "in_task", "assist_exposure", { task: "A", step, content_id: `A${step}-hint`, kind: "hint", attempt: 1 }),
    ...(switchToSolo ? [ev("taskA", "in_task", "assist_switch", { task: "A", from: "hint", to: "solo", by: "user" })] : []),
    ev("taskA", "in_task", "task_step", { task: "A", step, phase: "submit", answer: ({ ...CHECK_TASKS, ...ENGINE_CONFIG.tasks })[`A:${step}`]!.answer, content_id: ({ ...CHECK_TASKS, ...ENGINE_CONFIG.tasks })[`A:${step}`]!.content_id, attempt: 1, actions: ({ ...CHECK_TASKS, ...ENGINE_CONFIG.tasks })[`A:${step}`]!.actions }),
  ]);
}

/** 第一幕三轮都按关键证据核对事实、作出与证据一致的判断。 */
function verifiedSpecs(action: Action): RoundSpec[] {
  return ROUNDS.map((r) => ({ round_id: r.round_id, flips: [r.key_card!], final: r.verdict, action, followupAnswer: null }));
}

export function runChecks(events: readonly GameEvent[], specs: RoundSpec[], outcomes: import("../engine/settle").Outcomes, engine: Engine = REAL): CheckResult[] {
  const base = run(engine, events);
  const results: CheckResult[] = [];
  const add = (name: string, expected: string, actual: string, pass: boolean) => results.push({ id: results.length + 1, name, expected, actual, pass });

  // 1. 模拟替换事后走势：画像与推荐的输入里没有收益，只有代币会变
  {
    const decisions = specs.map((s) => ({ round_id: s.round_id, action: s.action }));
    const a = settle(decisions, outcomes).balance;
    const b = settle(decisions, flipOutcomes(outcomes, ROUNDS.map((r) => r.round_id))).balance;
    const anyFollow = specs.some((s) => s.action === "follow");
    // 画像不变不是靠再跑一遍比出来的：evaluate / recommend 的输入只有事件记录，
    // 整条导入链里没有 settle 和揭晓数据，由 engine.test.ts 逐个模块检查。这里只验证走势确实会改变代币。
    add("模拟替换事后走势（模拟反例，不是真实行情）", "判断线、画像、推荐不变；选过“跟”时代币改变",
      `代币 ${a.toFixed(2)} → ${b.toFixed(2)}；画像与推荐的输入只有事件记录、不含走势，所以不变（导入链由自动测试检查）`,
      !anyFollow || a !== b);
  }

  // 2. 重复点击牌、重复打开解释、重复提交同一答案
  {
    const dupTypes = new Set(["card_flip", "explain_open", "final_assessment", "followup_answer", "task_step", "assist_exposure"]);
    const doubled = events.flatMap((e): GameEvent[] => (dupTypes.has(e.type) ? [e, { ...e, event_id: `${e.event_id}:dup` }] : [e]));
    const ok = same(run(engine, doubled), base);
    add("重复点击牌、重复打开解释、重复提交同一答案", "不增加证据", ok ? "输出逐字节相同" : "重复事件改变了输出", ok);
  }

  // 3. 只改交易行动
  {
    const cycle: Record<Action, Action> = { follow: "skip", skip: "wait", wait: "follow" };
    const changed = events.map((e) => (e.type === "decision" ? ({ ...e, payload: { action: cycle[e.payload.action] } } as GameEvent) : e));
    const out = run(engine, changed);
    const ok = same(out.profile, base.profile) && same(out.progress, base.progress) && same(out.plan, base.plan);
    add("只改交易行动（跟 → 不跟 → 先看看 轮换）", "能力、物种、推荐不变", ok ? "全部不变" : `推荐 ${planText(base.plan)} → ${planText(out.plan)}`, ok);
  }

  // 4. 只改最终判断：翻过关键牌的轮次要重算规则；没翻关键牌时，猜中方向也不算查证，规则保持“未查看”
  {
    const keyOf = (s: RoundSpec) => ROUNDS.find((r) => r.round_id === s.round_id)?.key_card;
    const target = specs.find((s) => s.flips.includes(keyOf(s) as Card)) ?? specs[0];
    if (!target) add("只改最终判断", "受影响规则重算", "这条记录没有可改的轮次", false);
    else {
      const fork = specs.map((s) => (s === target ? { ...s, final: VERDICT_FLIP[s.final], followupAnswer: null } : s));
      const out = run(engine, eventsFromSpecs(fork, ROUNDS, "check"));
      const ref = run(engine, eventsFromSpecs(specs, ROUNDS, "check"));
      const rule = (r: typeof out) => Object.values(r.profile.observations).flatMap((o) => o.instances).filter((i) => i.context === target.round_id).map((i) => i.rule).join("、") || "无";
      const flipped = target.flips.includes(keyOf(target) as Card);
      const ok = flipped ? rule(out) !== rule(ref) : rule(out) === rule(ref);
      add(`只改最终判断（${target.round_id}：${target.final} → ${VERDICT_FLIP[target.final]}）`,
        flipped ? "这一轮命中的规则重算，不当作改了交易" : "没翻关键牌：改判断也不会变成已查证",
        `${target.round_id} 命中规则 ${rule(ref)} → ${rule(out)}`, ok);
    }
  }

  // 5. 机械策略：不查证，或恒定一种判断
  {
    const strategies: [string, RoundSpec[]][] = [
      ["全程不翻牌", ROUNDS.map((r) => ({ round_id: r.round_id, flips: [] as Card[], final: r.verdict, action: "skip" as Action, followupAnswer: null }))],
      ...(["supports", "refutes", "insufficient"] as Verdict[]).map((v): [string, RoundSpec[]] => [
        `恒选${v}`,
        ROUNDS.map((r) => ({ round_id: r.round_id, flips: [r.key_card!], final: v, action: "skip" as Action, followupAnswer: null })),
      ]),
    ];
    const bad = strategies.filter(([, s]) => {
      const out = run(engine, eventsFromSpecs(s, ROUNDS, "check"));
      return out.progress.K === 2 || (out.profile.observations.O1.status === "observed" && out.profile.observations.O2.status === "observed");
    });
    add("机械策略：不查证 / 恒支持 / 恒否定 / 恒证据不足", "都不能得到 K=2，也不能同时满足 O1、O2",
      bad.length ? `${bad.map(([n]) => n).join("、")} 通过了` : "四种策略都没有通过", bad.length === 0);
  }

  // 6. 全程观望但核验了事实：不会因为没交易被拦
  {
    const waitAll = run(engine, [...eventsFromSpecs(verifiedSpecs("wait"), ROUNDS, "check"), ...hintedTaskA(900)]);
    const followAll = run(engine, [...eventsFromSpecs(verifiedSpecs("follow"), ROUNDS, "check"), ...hintedTaskA(900)]);
    const ok = waitAll.plan.task === "B" && same(waitAll.progress, followAll.progress) && same(waitAll.plan, followAll.plan);
    add("全程“先看看”但核验了事实", "完成基础步骤后进入任务 B，和全程“跟”的推荐相同", `全程先看看：${planText(waitAll.plan)}；全程跟：${planText(followAll.plan)}`, ok);
  }

  // 7. 看过提示再切到“我自己来”；带提示完成任务 A
  {
    const out = run(engine, [...eventsFromSpecs(verifiedSpecs("skip"), ROUNDS, "check"), ...hintedTaskA(900, [1, 2], true)]);
    const assisted = out.profile.task_observations.O1.every((i) => i.assisted) && out.profile.task_observations.O2.every((i) => i.assisted);
    const ok = assisted && out.progress.ready_for_B && out.plan.task === "B";
    add("看过提示后切到“我自己来”再提交", "记为在帮助下完成，不升级为独立；基础步骤完成后任务 B 开放",
      `${assisted ? "两步都记为在帮助下" : "被记成了独立完成"}；ready_for_B = ${out.progress.ready_for_B}`, ok);
  }

  // 8. 只互换 R3 两张牌的首翻顺序
  {
    const r3 = specs.find((s) => s.round_id === "R3");
    const pair: Card[] = r3 && r3.flips.length === 2 ? r3.flips : ["elephant", "leopard"];
    const make = (flips: Card[]) => specs.map((s) => (s.round_id === "R3" ? { ...s, flips } : s));
    const a = run(engine, eventsFromSpecs(make(pair), ROUNDS, "check"));
    const b = run(engine, eventsFromSpecs(make([pair[1]!, pair[0]!]), ROUNDS, "check"));
    // 比较规则命中与状态；事件编号的先后随翻牌顺序变化，不算能力变化
    const abilities = (r: typeof a) => Object.values(r.profile.observations).map((o) => [o.status, o.aggregation, o.instances.map((i) => [i.context, i.rule, i.outcome, i.assisted])]);
    const ok = same(abilities(a), abilities(b));
    add("只互换 R3 两张牌的首翻顺序", "能力观察不变；物种按首翻规则重算",
      `能力观察${ok ? "不变" : "变了"}；物种 ${a.profile.style.species} → ${b.profile.style.species}`, ok);
  }

  // 9. K=0，在提示下完成任务 A 两步
  {
    const none = ROUNDS.map((r) => ({ round_id: r.round_id, flips: [] as Card[], final: "insufficient" as Verdict, action: "wait" as Action, followupAnswer: null }));
    const before = run(engine, eventsFromSpecs(none, ROUNDS, "check"));
    const after = run(engine, [...eventsFromSpecs(none, ROUNDS, "check"), ...hintedTaskA(900)]);
    const ok = before.progress.K === 0 && after.progress.K === 0 && after.progress.ready_for_B && after.plan.task === "B";
    add("K=0，在提示下完成任务 A 两步", "任务 B 开放；K 如实保留为 0，不再送回任务 A",
      `K ${before.progress.K} → ${after.progress.K}；推荐 ${planText(before.plan)} → ${planText(after.plan)}`, ok);
  }

  return results;
}
