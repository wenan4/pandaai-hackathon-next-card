import type { EngineConfig } from "../engine/evaluate";
import type { TopicId } from "../engine/types";
import { RULES_VERSION } from "./constants";
import { UNDERSTANDING_ANSWERS } from "./copy";
import { ROUNDS } from "./rounds";

export const ENGINE_CONFIG: EngineConfig = {
  rules_version: RULES_VERSION,
  rounds: ROUNDS,
  understanding_answers: UNDERSTANDING_ANSWERS,
};

/** M1 只有猎豹题有数据入口 */
export const AVAILABLE_TOPICS: TopicId[] = ["cheetah"];
