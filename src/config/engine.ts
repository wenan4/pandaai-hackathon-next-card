import type { EngineConfig } from "../engine/evaluate";
import type { TopicId } from "../engine/types";
import { RULES_VERSION } from "./constants";
import { UNDERSTANDING_ANSWERS } from "./copy";
import { ROUNDS } from "./rounds";
import topics from "./taskB_topics.json";

export const ENGINE_CONFIG: EngineConfig = {
  rules_version: RULES_VERSION,
  rounds: ROUNDS,
  understanding_answers: UNDERSTANDING_ANSWERS,
};

/**
 * 已发布且通过口径检查的任务 B 主题。清单由 scripts/check_taskB.py --write-manifest 生成：
 * 哪个主题检查不通过，就不会出现在这里，界面也不会出现它。
 */
export const AVAILABLE_TOPICS: TopicId[] = (topics.topics as string[]).filter((t): t is TopicId => t === "cheetah" || t === "elephant" || t === "fox");
