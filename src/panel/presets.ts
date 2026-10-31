// 评委面板的预设路径（模拟，非真实玩家）。全部通过同一个 evaluate / recommend 重放，不硬编码画像。
// 暂定版：PRD v0.3 §9 的路径表到位后按表对齐。
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
  { round_id: "R1", initial: "supports", flips: ["elephant", "fox"], final: "refutes", action: "pass" },
  { round_id: "R2", initial: "refutes", flips: ["elephant"], final: "supports", action: "follow" },
  { round_id: "R3", initial: "supports", flips: ["elephant", "fox"], final: "supports", action: "wait", followupAnswer: "等未来走势" },
];

export const PRESETS: PresetPath[] = [
  {
    id: "jia",
    name: "甲",
    desc: "翻了牌，但没翻关键牌，结论碰巧对",
    specs: [
      { round_id: "R1", initial: "supports", flips: ["elephant", "leopard"], final: "refutes", action: "pass" },
      { round_id: "R2", initial: "unsure", flips: ["fox", "leopard"], final: "supports", action: "follow" },
      { round_id: "R3", initial: "supports", flips: ["fox"], final: "insufficient", action: "wait", followupAnswer: "之后的走势" },
    ],
  },
  { id: "yi", name: "乙", desc: "关键牌都看了，第 3 轮对未来下了判断", specs: YI },
  { id: "yi1", name: "乙′", desc: "同乙，只把三轮的事后走势全部翻转", specs: YI, flipOutcomes: ["R1", "R2", "R3"] },
  {
    id: "yi2",
    name: "乙″",
    desc: "同乙，只把第 1 轮行动从不跟改成跟",
    specs: YI.map((s) => (s.round_id === "R1" ? { ...s, action: "follow" as const } : s)),
  },
  {
    id: "bing",
    name: "丙",
    desc: "一张不翻，直接判断",
    specs: [
      { round_id: "R1", initial: "supports", flips: [], final: "supports", action: "follow" },
      { round_id: "R2", initial: "supports", flips: [], final: "supports", action: "follow" },
      { round_id: "R3", initial: "supports", flips: [], final: "supports", action: "follow" },
    ],
  },
];
