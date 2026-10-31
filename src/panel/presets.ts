// 评委面板的预设路径（模拟，非真实玩家），按 PRD v0.3 §9 的演示路径表。
// 全部通过同一个 evaluate / recommend 重放，不硬编码画像；甲只玩第一幕，乙系列与丙玩完两幕六轮。
import type { RoundSpec } from "../engine/paths";

export interface PresetPath {
  id: string;
  name: string;
  desc: string;
  specs: RoundSpec[];
  /** 只用于模拟反例：翻转这些轮次的事后走势 */
  flipOutcomes?: string[];
}

const YI: RoundSpec[] = [
  { round_id: "R1", initial: "refutes", flips: ["fox"], final: "refutes", action: "follow" },
  { round_id: "R2", initial: "refutes", flips: ["elephant"], final: "supports", action: "follow" },
  { round_id: "R3", initial: "unsure", flips: ["elephant", "leopard"], final: "insufficient", action: "wait", followupAnswer: "之后的走势" },
  { round_id: "R4", initial: "supports", flips: ["fox"], final: "supports", action: "pass" },
  { round_id: "R5", initial: "supports", flips: ["elephant"], final: "refutes", action: "follow" },
  { round_id: "R6", initial: "unsure", flips: ["elephant", "leopard"], final: "insufficient", action: "wait", followupAnswer: null },
];
const withRound = (id: string, patch: Partial<RoundSpec>) => YI.map((s) => (s.round_id === id ? { ...s, ...patch } : s));

export const PRESETS: PresetPath[] = [
  {
    id: "jia",
    name: "甲",
    desc: "只玩第一幕：每轮先翻量价，没翻关键牌；第 3 轮追问“图没看懂”",
    specs: [
      { round_id: "R1", initial: "supports", flips: ["leopard", "elephant"], explains: [{ card: "leopard", kind: "neutral" }], final: "supports", action: "follow" },
      { round_id: "R2", initial: "refutes", flips: ["leopard", "fox"], explains: [{ card: "leopard", kind: "neutral" }], final: "refutes", action: "pass" },
      { round_id: "R3", initial: "unsure", flips: ["leopard"], final: "insufficient", action: "wait", followupAnswer: "图没看懂" },
    ],
  },
  { id: "yi", name: "乙", desc: "两幕六轮：关键牌都看了，第 2、5 轮看完证据改了第一判断；反复跟稳步上行", specs: YI },
  { id: "yi1", name: "乙′", desc: "同乙，只把第 3 轮追问改成“图没看懂”", specs: withRound("R3", { followupAnswer: "图没看懂" }) },
  { id: "yi2", name: "乙″", desc: "同乙，只把第 1 轮翻牌改成“历史＋量价”，没看对照", specs: withRound("R1", { flips: ["elephant", "leopard"] }) },
  { id: "bing", name: "丙", desc: "同乙，只把第 3 轮两张牌的顺序改成“量价 → 历史”", specs: withRound("R3", { flips: ["leopard", "elephant"] }) },
];
