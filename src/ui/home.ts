// 占位首页。游戏壳与状态机见 YOU-154。
export function renderHome(): HTMLElement {
  const main = document.createElement("main");
  main.className = "screen";
  main.innerHTML = `
    <h1>下一张牌</h1>
    <p class="tagline">听到一个说法，先决定翻哪张牌。</p>
    <p class="muted">骨架占位页 · 游戏开发中</p>
  `;
  return main;
}
