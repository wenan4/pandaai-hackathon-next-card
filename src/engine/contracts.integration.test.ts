import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EventLogSchema, EvaluateOutputSchema, StructuredResultSchema, SettlementSchema, RoundsConfigSchema } from "../../contracts";
import { ENGINE_CONFIG } from "../config/engine";
import { PRESETS } from "../panel/presets";
import { evaluate, evaluateView } from "./evaluate";
import { eventsFromSpecs, eventFactory } from "./paths";
import { structuredResult } from "./result";
import { settle, settlementOutcome, flipOutcomes } from "./settle";
import { DEFAULT_UNKNOWNS } from "./outputs";
import { TEST_CONFIG, beginTaskB } from "./fixtures/taskRules";
import type { RoundConfig } from "./types";
import { RevealAfterSchema } from "../../contracts/data";

const example = (name: string) => JSON.parse(readFileSync(new URL(`../../contracts/examples/${name}`, import.meta.url), "utf8"));
describe("YOU-185 end-to-end contracts", () => {
  it("replays the frozen six-round example byte-for-byte in meaning", () => {
    const c = RoundsConfigSchema.parse(example("rounds.example.json"));
    const rounds: RoundConfig[] = c.rounds.map(r => ({ ...r, verdict: r.evidence_verdict, method_card: {...r.method_card,line:""}, explain: {fox:{...r.explain.fox,text:""},elephant:{...r.explain.elephant,text:""},leopard:{...r.explain.leopard,text:""}} }));
    const cfg = {...ENGINE_CONFIG,rounds};
    const events = EventLogSchema.parse(example("path-yi.events.json"));
    const output = structuredResult(events,cfg,["fox","elephant","cheetah"],{kind:"simulated_path",path_id:"乙"},DEFAULT_UNKNOWNS);
    expect(output).toEqual(example("result.path-yi.json"));
  });
  it("all game presets produce valid events and public outputs", () => {
    for(const preset of PRESETS){
      const events = eventsFromSpecs(preset.specs,ENGINE_CONFIG.rounds);
      expect(EventLogSchema.safeParse(events).success).toBe(true);
      expect(EvaluateOutputSchema.safeParse(evaluate(events,ENGINE_CONFIG)).success).toBe(true);
      expect(StructuredResultSchema.safeParse(structuredResult(events,ENGINE_CONFIG,["cheetah"],{kind:"simulated_path",path_id:preset.id},DEFAULT_UNKNOWNS)).success).toBe(true);
    }
    expect(EvaluateOutputSchema.safeParse(evaluate([],ENGINE_CONFIG)).success).toBe(true);
  });
  it("rejects caller-supplied correctness and requires data, content and actual operations", () => {
    const ev = eventFactory("contract-test","v0.3");
    const submit = ev("taskA","in_task","task_step",{task:"A",step:1,content_id:"sample-A1",attempt:1,phase:"submit",answer:"outperform",actions:["aligned"]});
    expect(EventLogSchema.safeParse([{...submit,payload:{...submit.payload,correct:true}}]).success).toBe(false);
    expect(evaluate([submit],ENGINE_CONFIG).progress.S1).toBe(false);
    expect(evaluate([submit],TEST_CONFIG).progress.S1).toBe(true);
    if(submit.type !== "task_step") throw new Error("fixture");
    for(const payload of [{...submit.payload,actions:[]},{...submit.payload,content_id:"another-question"},{...submit.payload,answer:"underperform"}]) expect(evaluate([{...submit,payload}],TEST_CONFIG).progress.S1).toBe(false);
  });
  it("B requires lock and test-open events even when the answer is known", () => {
    const ev=eventFactory("contract-test","v0.3");
    const submit=ev("taskB","in_task","task_step",{task:"B",step:3,content_id:"sample-B3",attempt:1,phase:"submit",answer:"no_observed_advantage|delta_low",actions:["rules_locked","display_viewed","test_viewed"]});
    expect(evaluate([submit],TEST_CONFIG).progress.taskB_done).toBe(false);
    expect(evaluate([...beginTaskB(ev),submit],TEST_CONFIG).progress.taskB_done).toBe(true);
  });
  it("system assistance suggestions do not masquerade as user preference", () => {
    const ev=eventFactory("contract-test","v0.3");
    const change=ev("taskA","in_task","assist_switch",{task:"A",from:"hint",to:"solo",by:"system"});
    expect(evaluate([change],ENGINE_CONFIG).profile.help_preference.user_selected).toBeNull();
    expect(evaluateView([change],ENGINE_CONFIG).profile.help_preference.source).not.toBe("user");
  });
});

describe("settlement execution boundaries",()=>{
  const valid={open_t1:100,close_t20:110};
  it("reveal data preserves missing endpoints through validation into settlement",()=>{
    const data=JSON.parse(readFileSync(new URL("../../public/data/cases_reveal_R1.json",import.meta.url),"utf8"));
    const after={...data.rounds[0].after,open_t1:null,return_open_t1_to_close_t20:null};
    expect(settlementOutcome(RevealAfterSchema.parse(after)).note).toContain("执行价");
    expect(RevealAfterSchema.safeParse({...after,return_open_t1_to_close_t20:0}).success).toBe(false);
  });
  it.each([
    [{...valid,open_t1:null},"执行价"],
    [{...valid,close_t20:null},"退出价"],
    [{...valid,t1_suspended:true},"T+1 停牌"],
    [{...valid,t20_suspended:true},"T+20 停牌"],
    [{...valid,t1_open_at_limit_up:true},"涨停"],
    [{...valid,t20_at_limit_down:true},"跌停"],
  ])("unexecutable windows retain the reason",(window,reason)=>{
    const s=settle([{round_id:"R1",action:"follow"}],{R1:settlementOutcome(window)});
    expect(SettlementSchema.safeParse(s).success).toBe(true);
    expect(s.balance).toBe(100);
    expect(s.rounds[0]?.settlement_note).toContain(reason);
  });
  it("ordinary and simulated outcomes keep profile input isolated",()=>{
    const out={R1:settlementOutcome(valid)};
    expect(settle([{round_id:"R1",action:"follow"}],out).balance).toBe(103);
    expect(settle([{round_id:"R1",action:"follow"}],flipOutcomes(out,["R1"]),true)).toMatchObject({balance:97,counterfactual:true});
    expect(settle([{round_id:"R1",action:"skip"}],out).rounds[0]).toMatchObject({chips_delta:0,hypothetical_delta:3});
  });
});
