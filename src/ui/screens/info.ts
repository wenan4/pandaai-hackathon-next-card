// 开局告知、开场、隐私说明、数据说明
import { VERDICT_COPY } from "../../config/copy";
import { ROUNDS } from "../../config/rounds";
import type { DataHeader, TaskAData } from "../../data/cases";
import type { Verdict } from "../../engine/types";
import { clearAll, emit, go, NOTICE_VERSION, update, type State } from "../../state/store";
import { footer, label, topbar } from "../components";
import { fmtDate, h } from "../dom";
import { icon } from "../icons";
import { revealedSources } from "./round";

const NOTICE_ITEMS: [string, string][] = [
  ["记录什么", "只记录这一局里的选择：第一判断、翻牌、最终判断、你的下一步、追问、任务步骤和帮助使用。不记录停留时长和鼠标轨迹，不采集姓名、手机号等个人信息。"],
  ["用来做什么", "生成本局的人物卡和下一关推荐。演示和评审时可能被评委查看；如果你同意，试玩记录会用于改进游戏。"],
  ["存在哪里", "只保存在这台设备的浏览器本地存储里，不上传服务器（这个项目没有服务端）。"],
  ["怎么清除", "开场页和隐私说明页都有“清除本局记录”按钮，点一下就全部删掉。"],
];

function noticeList(): HTMLElement {
  return h(
    "dl",
    { class: "stack", style: "gap:12px;margin:0" },
    NOTICE_ITEMS.map(([k, v]) => h("div", { class: "panel stack", style: "gap:4px" }, h("dt", { class: "bold" }, k), h("dd", { class: "small text-2", style: "margin:0" }, v))),
  );
}

export function noticeScreen(): HTMLElement {
  const ack = () =>
    update((s) => {
      s.notice_version = NOTICE_VERSION;
      emit(s, "session", "pre_reveal", "notice_ack", { notice_version: NOTICE_VERSION });
      s.screen = "start";
    });
  return h(
    "main",
    { class: "screen" },
    h("h1", { class: "display", style: "margin-top:12px" }, "开始之前"),
    h("p", { class: "small text-2" }, "这是一个研究练习游戏。先花半分钟看看它会记录什么。"),
    noticeList(),
    h("div", { class: "grow" }),
    h("button", { class: "btn", onclick: ack }, "我知道了"),
    footer(),
  );
}

function clearButton(): HTMLElement {
  return h(
    "button",
    {
      class: "btn-text",
      onclick: () => {
        if (window.confirm("清除本局的全部记录？已翻的牌、判断和人物卡都会删除，无法恢复。")) clearAll();
      },
    },
    "清除本局记录",
  );
}

export function startScreen(s: State): HTMLElement {
  const started = s.events.some((e) => e.type === "initial_reaction");
  const resume = () => {
    if (s.taskB) return go("taskB");
    if (s.taskA) return go(s.taskA.done ? "updated" : "taskA");
    if (s.rounds.every((r) => r.locked)) return go("profile");
    go("round");
  };
  const fan = (card: "fox" | "elephant" | "leopard", style: string, color: string, text: string) =>
    h(
      "div",
      { style: `position:absolute;width:96px;height:134px;border-radius:14px;background:var(--paper);box-shadow:0 10px 24px rgba(0,0,0,.45);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:${color};${style}` },
      icon(card, 38),
      h("span", { class: "xs bold" }, text),
    );
  return h(
    "main",
    { class: "screen" },
    h("div", { class: "row", style: "justify-content:space-between" }, h("span", { class: "xs muted" }, "PandaAI 苏客松 · 研究练习"), h("button", { class: "btn-text", onclick: () => go("privacy") }, "隐私说明")),
    h(
      "div",
      { style: "position:relative;height:170px", "aria-hidden": "true" },
      fan("fox", "left:calc(50% - 140px);top:22px;transform:rotate(-12deg)", "var(--fox-ink)", "同期对照"),
      fan("elephant", "left:calc(50% - 48px);top:4px;z-index:2", "var(--ele-ink)", "更长历史"),
      fan("leopard", "left:calc(50% + 44px);top:22px;transform:rotate(12deg)", "var(--leo-ink)", "近期量价"),
    ),
    h(
      "div",
      { class: "row", style: "align-items:flex-start" },
      h("div", { class: "parrot" }, icon("parrot", 24)),
      h("p", { class: "panel small", style: "border-radius:4px 14px 14px 14px;padding:10px 12px" }, "我是小道消息鹦鹉。每轮我说一句话，你先决定翻哪张牌，再判断我说得对不对。"),
    ),
    h("div", null, h("h1", { class: "display", style: "font-size:58px;line-height:1" }, "下一张牌"), h("p", { class: "text-2", style: "margin-top:8px" }, "听到一个说法，先决定翻哪张牌。")),
    h(
      "ol",
      { class: "stack small", style: "margin:0;padding-left:20px;gap:6px;color:var(--text-2)" },
      h("li", null, `三轮，每轮最多翻 2 张牌，也可以一张不翻`),
      h("li", null, "先判断这句话，再决定下一步"),
      h("li", null, "判断和代币分开算，赚赔不进画像"),
    ),
    h("div", { class: "grow" }),
    h("button", { class: "btn", onclick: started ? resume : () => go("round") }, started ? "继续" : "开始第一轮", icon("arrow", 18, 2)),
    h("div", { class: "row", style: "justify-content:center;gap:4px" }, h("button", { class: "btn-text", onclick: () => go("data") }, "数据说明"), started ? clearButton() : null),
    footer(),
  );
}

export function privacyScreen(s: State): HTMLElement {
  return h(
    "main",
    { class: "screen" },
    topbar({ title: "隐私说明", onBack: () => go(s.back && s.back !== "privacy" ? s.back : "start") }),
    noticeList(),
    h("p", { class: "xs muted" }, `告知版本：${NOTICE_VERSION}。分享人物卡时只包含物种和限定说明，不包含你的任何选择记录。`),
    h("div", { class: "panel row", style: "justify-content:space-between" }, h("span", { class: "small" }, `本机记录：${s.events.length} 条`), clearButton()),
    footer(),
  );
}

const DEFINITIONS: [string, string][] = [
  ["累计涨跌", "区间最后一天 ÷ 第一天 − 1"],
  ["最大回撤", "从此前最高点往下跌的最大比例"],
  ["量比", "当天成交量 ÷ 之前 20 个交易日的平均量，平均量不含当天"],
  ["决策时可见", "截至决策日 T 收盘的数据"],
  ["“跟”的演示", "T+1 开盘进入、T+20 收盘退出，收益 = 退出价 ÷ 进入价 − 1，不含费用和滑点"],
];

const LIMITS = [
  "案例是按规则筛选出的教学案例，不代表随机样本。",
  "前复权以数据截止日为锚，绝对价位不是当时的成交价，但不影响区间涨跌。",
  "行业基准用中证全指一级行业指数，和申万口径不完全一致。",
  "收益是简化模拟，没有计入交易成本。",
];

function headerRows(hd: DataHeader): [string, string][] {
  const rows: [string, unknown][] = [
    ["数据来源", hd["source"]],
    ["接口", hd.apis?.join("、")],
    ["数据截至", hd.data_as_of ? fmtDate(hd.data_as_of) : undefined],
    ["股票池", hd.pool],
    ["基准", hd.benchmark],
    ["复权", hd.adjustment],
    ["分红", hd.dividends],
    ["成交量", hd.volume],
    ["归一化", hd.normalization],
    ["筛选与选取", hd.selection],
    ["行业", hd.industry_note],
    ["公开展示", hd.public_scope],
    ["脚本版本", hd.script_version],
  ];
  return rows.filter(([, v]) => typeof v === "string" && v) as [string, string][];
}

export function dataScreen(s: State, taskA: TaskAData | null): HTMLElement {
  const revealed = revealedSources().sort((a, b) => a.round_id.localeCompare(b.round_id));
  const header = revealed[0]?.header;
  return h(
    "main",
    { class: "screen" },
    topbar({ title: "数据说明", onBack: () => go(s.back && s.back !== "data" ? s.back : "start") }),
    h("div", { class: "row wrap" }, label("real"), h("span", { class: "xs muted" }, "曲线是 Panda Data 日线归一化后的结果，不展示原始行情表。")),
    h(
      "section",
      { class: "panel stack" },
      h("h2", null, "统一口径"),
      h("dl", { class: "kv" }, DEFINITIONS.map(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
    ),
    header
      ? h("section", { class: "panel stack" }, h("h2", null, "数据文件头"), h("dl", { class: "kv" }, headerRows(header).map(([k, v]) => [h("dt", null, k), h("dd", null, v)])))
      : h("p", { class: "panel small text-2" }, "揭晓第一轮后，这里会显示数据文件头里的接口、截止日期和口径。"),
    h(
      "section",
      { class: "panel stack" },
      h("h2", null, "本局的案例"),
      ROUNDS.map((r) => {
        const hit = revealed.find((x) => x.round_id === r.round_id);
        if (!hit) return h("p", { class: "small muted" }, `${r.round_id} · 标的 ${r.label}：揭晓后显示`);
        const src = hit.round.source;
        return h(
          "div",
          { class: "stack", style: "gap:2px;padding:6px 0;border-top:1px solid var(--line)" },
          h("span", { class: "small bold" }, `${r.round_id} · ${r.label} = ${src.symbol} ${src.name}`),
          h("span", { class: "xs text-2" }, `命题：${src.claim}`),
          h("span", { class: "xs text-2" }, `证据结论：${VERDICT_COPY[src.evidence_verdict as Verdict]?.label ?? src.evidence_verdict}；决策日 ${fmtDate(src.decision_date)}；3 年窗口 ${fmtDate(src.windows.elephant[0])} 起`),
          h("span", { class: "xs muted" }, src.hindsight_disclosure),
        );
      }),
    ),
    taskA && s.taskA?.done
      ? h(
          "section",
          { class: "panel stack" },
          h("h2", null, "任务 A 的标的 D"),
          h("p", { class: "small text-2" }, `${taskA.source.symbol} ${taskA.source.name}，决策日 ${fmtDate(taskA.source.decision_date)}。`),
          h("p", { class: "xs muted" }, String(taskA.header.selection ?? "")),
        )
      : null,
    h("section", { class: "panel stack" }, h("div", { class: "row" }, h("h2", { class: "grow" }, "任务 B · 猎豹题"), label("todo")), h("p", { class: "small text-2" }, "股票池、展示段 / 检验段、样本数和阈值会在数据生成后由文件头渲染到这里。")),
    h(
      "section",
      { class: "panel stack" },
      h("div", { class: "row" }, h("h2", { class: "grow" }, "QuantSkills"), label("sample", "拟参考")),
      h("p", { class: "small text-2" }, "quantskills/skill-quant-research 已核验存在（GPL-3.0），只作方法参考，没有集成到本作品。"),
      h("a", { href: "https://github.com/quantskills/skill-quant-research", target: "_blank", rel: "noopener", class: "small" }, "github.com/quantskills/skill-quant-research"),
    ),
    h("section", { class: "panel stack" }, h("h2", null, "已知局限"), h("ul", { class: "small text-2", style: "margin:0;padding-left:18px" }, LIMITS.map((l) => h("li", null, l)))),
    footer(),
  );
}
