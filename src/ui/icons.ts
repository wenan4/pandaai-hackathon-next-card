// 线条图标（内联 SVG，颜色跟随 currentColor）。字符串都是本文件里的常量。
const PATHS = {
  fox: '<path d="M3 4l5 5h8l5-5-1 9-8 7-8-7z"/><path d="M9.5 13h.01M14.5 13h.01"/>',
  elephant:
    '<path d="M7 10a5 5 0 0 1 10 0v4a3 3 0 0 1-2 2.8V20a1.5 1.5 0 0 1-3 0"/><path d="M7 9C3.5 8 2 12 3.5 15c.8 1.4 3.5.8 3.5-1"/><path d="M17 9c3.5-1 5 3 3.5 6-.8 1.4-3.5.8-3.5-1"/><path d="M10 11h.01M14 11h.01"/>',
  leopard:
    '<path d="M4 9l1-6 4 4h6l4-4 1 6c1 6-3 11-8 11S3 15 4 9z"/><circle cx="9" cy="12" r="0.9" fill="currentColor"/><circle cx="15" cy="12" r="0.9" fill="currentColor"/><circle cx="12" cy="15.5" r="0.9" fill="currentColor"/>',
  parrot: '<path d="M14 4c-4 0-7 3-7 7v9h5c3.5 0 6-2.5 6-6"/><path d="M14 4c3 0 5 2 5 4.5l-2.5 1c0-1.6-1.2-2.7-2.5-2.7"/><path d="M12.5 8h.01"/><path d="M9 20l-2 2M12 20l-1 2"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17h.01"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v6h14v-6"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.5h5"/>',
  bookmark: '<path d="M6 4h12v16l-6-4-6 4z"/>',
  observed: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  assisted: '<circle cx="12" cy="12" r="9"/><path d="M8 13l2.5 2.5L16 10"/><path d="M12 3v2"/>',
  uncertain: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/><path d="M10 10a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2M12 16h.01"/>',
  not_observed: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 20, strokeWidth = 1.8): SVGSVGElement {
  const t = document.createElement("template");
  t.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return t.content.firstElementChild as SVGSVGElement;
}
