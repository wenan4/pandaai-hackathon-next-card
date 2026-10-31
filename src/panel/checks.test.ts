import { describe, expect, it } from "vitest";
import reveal from "../../public/data/cases_reveal.json";
import { ROUNDS } from "../config/rounds";
import { evaluateView as evaluate } from "../engine/evaluate";
import { eventsFromSpecs } from "../engine/paths";
import { recommendView as recommend } from "../engine/recommend";
import type { GameEvent } from "../engine/types";
import { runChecks, type Engine } from "./checks";
import { PRESETS } from "./presets";

const outcomes = Object.fromEntries(reveal.rounds.map((r) => [r.round_id, r.after.return_open_t1_to_close_t20]));

describe("9 项反例检查（YOU-161）", () => {
  for (const p of PRESETS) {
    it(`基线 ${p.name}：9 项全部通过`, () => {
      const results = runChecks(eventsFromSpecs(p.specs, ROUNDS, "judge"), p.specs, outcomes);
      expect(results).toHaveLength(9);
      expect(results.filter((r) => !r.pass), JSON.stringify(results.filter((r) => !r.pass))).toEqual([]);
    });
  }

  const yi = PRESETS.find((p) => p.id === "yi")!;
  const events = eventsFromSpecs(yi.specs, ROUNDS, "judge");

  it("故意让 evaluate 读取交易行动：第 3 项变红", () => {
    const broken: Engine = {
      recommend,
      evaluate: (ev, cfg) => {
        const out = evaluate(ev, cfg);
        const actions = ev.flatMap((e) => (e.type === "decision" ? [e.payload.action] : [])).join(",");
        return { ...out, profile: { ...out.profile, flags: { ...out.profile.flags, actions } as never } };
      },
    };
    const r = runChecks(events, yi.specs, outcomes, broken);
    expect(r[2]!.pass).toBe(false);
  });

  it("故意让重复事件算两次：第 2 项变红", () => {
    const broken: Engine = {
      recommend,
      evaluate: (ev, cfg) => {
        const out = evaluate(ev, cfg);
        return { ...out, progress: { ...out.progress, rounds_completed: ev.filter((e: GameEvent) => e.type === "card_flip").length } };
      },
    };
    expect(runChecks(events, yi.specs, outcomes, broken)[1]!.pass).toBe(false);
  });

  it("故意让提示后切换档位清除帮助记录：第 7 项变红", () => {
    const broken: Engine = {
      recommend,
      evaluate: (ev, cfg) => evaluate(ev.filter((e) => e.type !== "assist_exposure"), cfg),
    };
    expect(runChecks(events, yi.specs, outcomes, broken)[6]!.pass).toBe(false);
  });
});
