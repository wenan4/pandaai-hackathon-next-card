// 评委面板入口（?judge=1）。功能见 YOU-160 / YOU-161。
export function isJudgeMode(search: string = location.search): boolean {
  return new URLSearchParams(search).get("judge") === "1";
}

export function renderPanel(): HTMLElement {
  const main = document.createElement("main");
  main.className = "screen";
  main.innerHTML = `
    <h1>评委面板</h1>
    <p class="muted">占位页 · 预设路径重放与反例检查开发中</p>
  `;
  return main;
}
