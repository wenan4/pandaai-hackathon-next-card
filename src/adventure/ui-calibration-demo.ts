import { h } from "../ui/dom";
import { calibrationDemoContext, makeCalibrationDemo } from "./calibration-demo";
import { compareSelfForecast, type ContractAction, type Feeling, type Forecast } from "./research";
import type { Run } from "./types";
import { button, coins, note, pill } from "./ui-components";

interface Context { refresh: () => void; isVisible: () => boolean; onExposed: (caseId: string) => void }
const feelingOptions: [Feeling, string][] = [["low", "不太在意"], ["mild", "轻微在意"], ["noticeable", "明显在意"], ["strong", "强烈在意"], ["unknown", "说不清"]];
const actionOptions: [ContractAction, string][] = [["continue", "继续持有"], ["half", "回收一半"], ["all", "全部回收"], ["unknown", "不确定"]];
const affectResult = { stronger: "比事前预想更强", similar: "与事前预想接近", weaker: "比事前预想更轻", unknown: "信息不足" } as const;
const actionResult = { same: "与预想一致", different: "与预想不同", unknown: "信息不足" } as const;

/** A self-contained judge simulation. It never writes a forecast or response to a profile. */
export class CalibrationDemoUI {
  private run: Run | null = null;
  private loading = false;
  private error: string | null = null;
  private epoch = 0;
  private beforeFeeling: Feeling = "mild";
  private beforeAction: ContractAction = "continue";
  private afterFeeling: Feeling = "noticeable";
  private afterAction: ContractAction = "half";
  constructor(private ctx: Context) {}
  reset(): void {
    this.epoch++;
    this.run = null; this.loading = false; this.error = null;
    this.beforeFeeling = "mild"; this.beforeAction = "continue";
    this.afterFeeling = "noticeable"; this.afterAction = "half";
  }
  private async load(): Promise<void> {
    if (this.loading) return;
    const epoch = ++this.epoch;
    this.loading = true; this.error = null; this.ctx.refresh();
    try {
      const run = await makeCalibrationDemo();
      if (epoch !== this.epoch || !this.ctx.isVisible()) return;
      this.run = run; this.ctx.onExposed(run.caseId);
    } catch (error) { if (epoch === this.epoch && this.ctx.isVisible()) this.error = error instanceof Error ? error.message : "案例加载失败，请重试。"; }
    finally { if (epoch === this.epoch) { this.loading = false; if (this.ctx.isVisible()) this.ctx.refresh(); } }
  }
  private select<T extends string>(label: string, value: T, options: [T, string][], set: (value: T) => void): HTMLElement {
    return h("label", { class: "field" }, label, h("select", { "data-focus-key": `sim-${label}`, onchange: (event: Event) => { set((event.currentTarget as HTMLSelectElement).value as T); this.ctx.refresh(); } }, options.map(([id, title]) => h("option", { value: id, selected: id === value }, title))));
  }
  render(): HTMLElement {
    const run = this.run;
    let comparison: HTMLElement | null = null;
    if (run) {
      const context = calibrationDemoContext(run);
      const forecast: Forecast = { id: "simulated-forecast", caseId: run.caseId, amountCents: context.amountCents, lossMin: .1, lossMax: .2, minCashCents: 1000, minHealthRatio: .5, feeling: this.beforeFeeling, action: this.beforeAction, priorExposure: false, beforeFuture: true, withdrawn: false };
      const result = compareSelfForecast(forecast, context, this.afterFeeling, this.afterAction);
      comparison = h("div", { class: "stack" }, note(`真实历史派生案例 · 初始参与 ${coins(context.amountCents)} 金币，当前参考价值 ${coins(context.referenceValueCents)} 金币；可用 ${coins(context.cashCents)} 金币，生命 ${context.health}/${context.maxHealth}。当前停在回收选择之前。`),
        h("p", { class: "hint" }, "模拟假设：事前尚未见过案例，目标与理解没有变化；条件为价值较投入下降 10%–20%，且至少保留 10 金币与一半生命。下列回答均为模拟输入。"),
        h("div", { class: "choice-grid" }, this.select("模拟：事前预计的感受", this.beforeFeeling, feelingOptions, (value) => { this.beforeFeeling = value; }), this.select("模拟：事前预计的行动", this.beforeAction, actionOptions, (value) => { this.beforeAction = value; }), this.select("模拟：此刻自报的感受", this.afterFeeling, feelingOptions, (value) => { this.afterFeeling = value; }), this.select("模拟：此刻选择的行动", this.afterAction, actionOptions, (value) => { this.afterAction = value; })),
        h("div", { class: "notice" }, h("strong", null, result.comparison === "matched" ? "模拟条件可比较" : "模拟条件不可比较"), h("p", null, result.comparison === "matched" ? `感受：${affectResult[result.affectComparison]}；行动：${actionResult[result.actionComparison]}。` : result.unavailableReason ?? "条件不足，不能比较。")),
        h("p", { class: "fineprint" }, "分叉与回答仅供模拟，不写入真实画像；感受与行动分别比较，不能推断现实财务承受能力。"));
    }
    return h("section", { class: "panel stack" }, h("div", { class: "panel-head" }, h("div", null, h("h3", null, "模拟预期与实际对照"), h("p", { class: "hint" }, "用正式游戏状态和同一比较规则，尝试不同的模拟回答。")), pill("模拟", "gold")),
      !run ? button(this.loading ? "正在准备真实案例…" : this.error ? "重试准备模拟案例" : "打开模拟对照", () => void this.load(), "small secondary", this.loading) : null,
      this.error ? note(this.error, true) : null, comparison);
  }
}
