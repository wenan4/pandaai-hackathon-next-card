// 任务 B 多主题（YOU-166）：已发布主题清单、各主题数据与共用判定一致、默认主题的来源与分歧规则。
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TaskBDataSchema } from "../../contracts";
import { AVAILABLE_TOPICS } from "../config/engine";
import manifest from "../config/taskB_topics.json";
import { recommend, selectedTopic } from "./recommend";
import { verdict } from "./taskB";
import type { GameEvent, Profile, Progress, TopicId } from "./types";

const dir = new URL("../../public/data/", import.meta.url);
const load = (topic: string) => JSON.parse(readFileSync(new URL(`taskB_${topic}.json`, dir), "utf8"));

describe("已发布主题清单", () => {
  it("清单由检查脚本生成，界面只用清单里的主题", () => {
    expect(AVAILABLE_TOPICS).toEqual(manifest.topics);
    expect(new Set(AVAILABLE_TOPICS).size).toBe(AVAILABLE_TOPICS.length);
  });

  it("清单里的每个主题都有通过契约的数据文件，结论与共用判定一致", () => {
    const files = readdirSync(dir);
    for (const topic of AVAILABLE_TOPICS) {
      expect(files).toContain(`taskB_${topic}.json`);
      const d = load(topic);
      expect(TaskBDataSchema.safeParse(d).success).toBe(true);
      expect(d.header.topic).toBe(topic);
      expect(verdict(d, d.header.thresholds)).toEqual(d.verdict);
      expect(d.verdict.result).toBe((manifest.checked as Record<string, { result: string }>)[topic]!.result);
    }
  });

  it("狐狸题比较超额收益，其余比较收益；按自然月持有时没有固定天数", () => {
    for (const topic of AVAILABLE_TOPICS) {
      const h = load(topic).header;
      expect(h.primary_metric.id).toBe(topic === "fox" ? "share_positive_excess_return" : "share_positive_return");
      expect(h.execution.horizon_days).toBe({ cheetah: 20, elephant: 250, fox: null }[topic]);
    }
  });
});

// 推荐只读 profile 的物种与 O3-d 标记；这里构造最小 profile，其他字段不参与主题选择
const profile = (species: Profile["style"]["species"], o3d = false): Profile =>
  ({
    rules_version: "v0.3",
    observations: { O4: { status: "observed" } },
    style: { species, first_flips: [], counts: { fox: 0, elephant: 0, leopard: 0 } },
    help_preference: { level: "self", source: "explain_count", explain_count: 0 },
    flags: { o3d },
  }) as unknown as Profile;
const ready: Progress = { K: 2, S1: true, S2: true, rounds_completed: 6, taskA_steps_done: [], taskB_done: false, ready_for_B: true };
const ALL: TopicId[] = ["cheetah", "elephant", "fox"];

describe("任务 B 默认主题（PRD v0.3 §5.2）", () => {
  it("押注和物种一致：两个来源都记下，没有分歧", () => {
    const p = recommend(profile("elephant"), ready, ALL, { betTopic: "elephant" });
    expect(p).toMatchObject({ topic: "elephant", topic_source: "bet", topic_sources: ["bet", "style_default"], topic_conflict: false });
  });

  it("押注和物种指向不同主题：默认高亮押注的主题，两个来源同时给出", () => {
    const p = recommend(profile("fox"), ready, ALL, { betTopic: "elephant" });
    expect(p).toMatchObject({ topic: "elephant", topic_source: "bet", topic_sources: ["bet", "style_default"], topic_conflict: true });
    expect(p.reason).toContain("狐狸题");
  });

  it("用户明确选题优先；O3-d 次之；混合倾向且无押注时进入选题入口", () => {
    expect(recommend(profile("fox", true), ready, ALL, { userTopic: "elephant", betTopic: "fox" })).toMatchObject({ topic: "elephant", topic_source: "user", topic_conflict: false });
    expect(recommend(profile("fox", true), ready, ALL, { betTopic: "elephant" })).toMatchObject({ topic: "cheetah", topic_source: "o3d" });
    expect(recommend(profile("mixed"), ready, ALL)).toMatchObject({ topic: null, topic_source: null, topic_sources: [] });
  });

  it("没发布的主题不会被推荐", () => {
    expect(recommend(profile("elephant"), ready, ["cheetah"], { betTopic: "fox" })).toMatchObject({ topic: "cheetah", topic_source: "only_available" });
    expect(recommend(profile("fox"), ready, ["cheetah", "elephant"], { betTopic: "elephant" })).toMatchObject({ topic: "elephant", topic_conflict: false });
  });

  it("只有来源为 user 的 topic_select 算用户选题", () => {
    const ev = (topic: TopicId, source: "user" | "bet", n: number) =>
      ({ event_id: `t${n}`, session_id: "s", content_version: "v0.3", stage: "in_task", round_id: "taskB", type: "topic_select", payload: { topic, source } }) as GameEvent;
    expect(selectedTopic([ev("fox", "bet", 1)])).toBeUndefined();
    expect(selectedTopic([ev("fox", "user", 1), ev("elephant", "bet", 2)])).toBe("fox");
    expect(selectedTopic([ev("fox", "user", 1), ev("cheetah", "user", 2)])).toBe("cheetah");
  });
});
