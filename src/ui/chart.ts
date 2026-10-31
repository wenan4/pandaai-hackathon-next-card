// 轻量 SVG 走势图与量比柱，不引入图表库。宽度随容器缩放（viewBox）。
import { h, s } from "./dom";

export interface Series {
  values: number[];
  color: string;
  width?: number;
  dash?: string;
  /** 序列在横轴上的起点（用于揭晓时把后续走势接在后面） */
  offset?: number;
}

export interface LineChartOpts {
  series: Series[];
  label: string;
  height?: number;
  /** 横轴总点数，默认取最长序列 */
  points?: number;
  baseline?: number;
  /** 从这个点开始画阴影，标注“决策后” */
  shadeFrom?: number;
  markers?: { index: number; value: number; color: string }[];
}

const W = 320;

export function lineChart(o: LineChartOpts): SVGSVGElement {
  const H = o.height ?? 120;
  const pad = 6;
  const n = o.points ?? Math.max(...o.series.map((x) => x.values.length + (x.offset ?? 0)));
  const all = o.series.flatMap((x) => x.values).concat(o.baseline !== undefined ? [o.baseline] : []);
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const span = hi - lo;
  lo -= span * 0.06;
  hi += span * 0.06;
  const X = (i: number) => ((i / Math.max(1, n - 1)) * W).toFixed(1);
  const Y = (v: number) => (pad + (H - 2 * pad) * (1 - (v - lo) / (hi - lo))).toFixed(1);

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": o.label, class: "chart" });
  if (o.shadeFrom !== undefined) {
    const x = Number(X(o.shadeFrom));
    svg.append(s("rect", { x, y: 0, width: W - x, height: H, fill: "currentColor", opacity: 0.08 }));
    svg.append(s("text", { x: x + 4, y: 14, "font-size": 11, fill: "currentColor", opacity: 0.75 }, "决策后"));
  }
  if (o.baseline !== undefined) {
    svg.append(s("line", { x1: 0, x2: W, y1: Y(o.baseline), y2: Y(o.baseline), stroke: "currentColor", "stroke-opacity": 0.3, "stroke-dasharray": "3 4" }));
  }
  for (const x of o.series) {
    const off = x.offset ?? 0;
    const pts = x.values.map((v, i) => `${X(i + off)},${Y(v)}`).join(" ");
    svg.append(
      s("polyline", {
        points: pts,
        fill: "none",
        stroke: x.color,
        "stroke-width": x.width ?? 2,
        "stroke-linejoin": "round",
        "stroke-dasharray": x.dash,
        "vector-effect": "non-scaling-stroke",
      }),
    );
  }
  for (const m of o.markers ?? []) {
    svg.append(s("circle", { cx: X(m.index), cy: Y(m.value), r: 4, fill: m.color }));
  }
  return svg;
}

/** 量比柱：1 倍虚线；≥1 倍用深色、带顶部描边，不只靠颜色区分。 */
export function volumeBars(values: (number | null)[], label: string): HTMLElement {
  const cap = 3;
  return h(
    "div",
    { class: "bars", role: "img", "aria-label": label },
    h("div", { class: "bars-one", style: `bottom:${(100 / cap).toFixed(1)}%` }),
    values.map((v) =>
      h("div", {
        class: v === null ? "bar bar-none" : v >= 1 ? "bar bar-hi" : "bar",
        style: `height:${v === null ? 4 : Math.max(4, (Math.min(v, cap) / cap) * 100).toFixed(1)}%`,
      }),
    ),
  );
}
