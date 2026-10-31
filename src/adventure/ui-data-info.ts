import { fmtDate, h } from "../ui/dom";
import { PRICE_SCALE, type MarketManifest } from "./market";
import type { GameEvent, MarketQuote, MarketStage, Run } from "./types";

const stageNames: Record<MarketStage, string> = {
  entry: "参与执行（T0 后的下一开盘）",
  t1: "第一段收盘参考（T0 后第 20 个交易日）",
  "t1-exec": "第一段后下一开盘",
  t2: "第二段收盘参考（T0 后第 40 个交易日）",
  "t2-exec": "第二段后下一开盘",
  t3: "第三段收盘参考（T0 后第 60 个交易日）",
  "final-exec": "终点后下一开盘",
  "exit-after-entry": "入场后提前结束的下一开盘",
  "exit-after-t1-exec": "第一段执行后提前结束的下一开盘",
  "exit-after-t2-exec": "第二段执行后提前结束的下一开盘",
};

type ShownQuote = { stage: MarketStage; date: string; price: number; description: string };

function validQuote(stage: unknown, date: unknown, price: unknown): stage is MarketStage {
  return typeof stage === "string" && Object.hasOwn(stageNames, stage)
    && typeof date === "string" && (/^\d{8}$/.test(date) || /^\d{4}-\d{2}-\d{2}$/.test(date))
    && typeof price === "number" && Number.isSafeInteger(price) && price > 0;
}

function eventQuote(event: GameEvent): ShownQuote | null {
  const { stage, date, price, amountCents, shareUnits, automatic } = event.data;
  if (event.type !== "market" || event.action !== "apply-quote" || !validQuote(stage, date, price)) return null;
  const isExecution = stage !== "t1" && stage !== "t2" && stage !== "t3";
  let description = stageNames[stage];
  if (stage === "entry") {
    if (amountCents === 0) description = "参与金额为零（T0 后的下一开盘仅推进时间）";
  } else if (isExecution) {
    description += typeof shareUnits === "string" && /^0+$/.test(shareUnits) ? "（未回收份额，仅推进时间）"
      : automatic === true ? "（自动回收结算）" : "（回收安排结算）";
  }
  return { stage, date: date as string, price: price as number, description };
}

/** The event log contains only applied stages. Pending requests are deliberately ignored. */
function shownQuotes(run: Run): ShownQuote[] {
  const quotes = run.history.map(eventQuote).filter((quote): quote is ShownQuote => quote !== null);
  const last: MarketQuote | null = run.market.lastQuote;
  // Old saved runs may retain the last revealed quote but lack its log entry.
  // In that case, describe only the observed time and price, not a presumed trade.
  if (last && last.caseId === run.caseId && validQuote(last.step, last.date, last.price)
      && !quotes.some((quote) => quote.stage === last.step && quote.date === last.date && quote.price === last.price)) {
    const name = last.step === "entry" ? "T0 后下一开盘" : stageNames[last.step];
    quotes.push({ stage: last.step, date: last.date, price: last.price, description: `${name}（已展示报价）` });
  }
  return quotes;
}

/** Whether the data panel will actually show any validated, applied quote. */
export function dataInfoShowsQuote(run: Run | null): boolean {
  return !!run && shownQuotes(run).length > 0;
}

/** Presentation only: reads metadata and the current run; never fetches any stage. */
export function dataInfoContent(manifest: MarketManifest | null, run: Run | null): HTMLElement {
  const current = run && manifest?.cases.find((item) => item.caseId === run.caseId);
  const quotes = run ? shownQuotes(run) : [];
  const scale = current?.priceScale ?? PRICE_SCALE;
  const source = manifest
    ? h("div", { class: "stack" },
      h("p", { class: "hint" }, manifest.source),
      h("p", { class: "fineprint" }, `数据截至 ${fmtDate(manifest.dataAsOf)}。使用接口：${manifest.apis.join("、")}（资产前复权日线、基准指数日线、交易日历）。`),
      h("p", { class: "fineprint" }, manifest.adjustment),
      h("p", { class: "fineprint" }, manifest.selection),
      ...manifest.limitations.map((item) => h("p", { class: "fineprint" }, item)),
      h("p", { class: "fineprint" }, "研究方法参考：", h("a", { href: "https://github.com/quantskills/skill-quant-research", target: "_blank", rel: "noopener noreferrer" }, "QuantSkills skill-quant-research"), "（GPL-3.0-only）。D2 借鉴固定判断、同期基准及样本边界；未复制代码或集成执行引擎。"),
      h("p", { class: "fineprint" }, "部分案例同标的且时间重叠，不作为独立新样本。静态文件分段只防止无意使用未来信息，并非保密机制。"))
    : h("p", { class: "hint" }, "数据目录尚未加载，可返回后重试。");

  return h("div", { class: "stack" },
    run ? h("div", { class: "stack" },
      h("strong", null, "本局已揭晓的历史"),
      current ? h("p", { class: "hint" }, `标的 ${current.name}（${current.symbol}）；T0 ${fmtDate(current.decisionDate)} 收盘；同期基准 ${current.benchmark}。`)
        : h("p", { class: "hint" }, "当前案例的来源目录尚未加载。"),
      h("p", { class: "fineprint" }, "以下均为相对值：标的 T0 收盘为 1，不是人民币价格。收盘仅作观察；参与和回收按下一可用开盘结算。"),
      quotes.length ? h("ol", null, quotes.map((quote) => h("li", { class: "fineprint" }, `${fmtDate(quote.date)} · ${quote.description}：${(quote.price / scale).toFixed(6)}`)))
        : h("p", { class: "fineprint" }, "还没有揭晓后续报价。"))
      : h("p", { class: "hint" }, "开始旅程后，可在这里查看本局已揭晓的历史时点与报价。"),
    h("details", null, h("summary", null, "查看数据来源和计算边界"), source),
    h("p", { class: "fineprint" }, "历史样本不代表未来表现，也不是现实投资建议。"));
}
