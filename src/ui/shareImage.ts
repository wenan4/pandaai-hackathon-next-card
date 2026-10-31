import { SPECIES_COPY } from "../config/copy";
import type { Species } from "../../contracts/common";

/** The exporter accepts only species, never State/Profile/events. */
export function shareContent(species: Species) {
  const s = SPECIES_COPY[species];
  return { title: "下一张牌 · 本局查法", name: s.name, method: s.method, helps: s.helps, watch: s.watch, scope: "只代表这一局，不代表稳定人格。", footer: "虚拟代币、研究练习，不构成投资建议。" };
}
export async function sharePng(species: Species): Promise<Blob> {
  const content = shareContent(species);
  const canvas = document.createElement("canvas");
  canvas.width = 1080; canvas.height = 1440;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建图片");
  ctx.fillStyle = "#0e131b"; ctx.fillRect(0, 0, 1080, 1440);
  ctx.fillStyle = "#f4efe4"; ctx.beginPath(); ctx.roundRect(54,54,972,1332,40); ctx.fill();
  const wrap = (text: string, y: number, size: number, color: string, bold = false) => {
    ctx.font = `${bold ? "bold " : ""}${size}px system-ui, sans-serif`; ctx.fillStyle = color; ctx.textBaseline = "top";
    let line = "";
    for (const char of Array.from(text)) {
      if (ctx.measureText(line + char).width > 840 && line) { ctx.fillText(line,120,y); y += size*1.65; line = char; }
      else line += char;
    }
    if (line) ctx.fillText(line,120,y);
    return y + size*1.65;
  };
  wrap(content.title,125,32,"#586275");
  let y = wrap(content.name,230,76,"#152132",true) + 25;
  y = wrap(content.method,y,42,"#276d63",true) + 65;
  y = wrap(content.helps,y,35,"#28364a") + 45;
  y = wrap(content.watch,y,35,"#28364a") + 60;
  wrap(content.scope,Math.max(y,1110),29,"#586275");
  wrap(content.footer,1260,24,"#586275");
  return new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("图片生成失败")), "image/png"));
}
export async function downloadSharePng(species: Species): Promise<void> {
  const blob = await sharePng(species);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "下一张牌-本局查法.png"; a.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
