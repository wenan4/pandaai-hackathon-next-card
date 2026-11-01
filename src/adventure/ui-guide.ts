import { h } from "../ui/dom";
import { button } from "./ui-components";

export type GuideTopic = "battle" | "cards" | "money" | "archive" | "profile";
const topics: { id: GuideTopic; label: string; pages: { title: string; body: string; example: string }[] }[] = [
  { id: "battle", label: "从零学战斗", pages: [
    { title: "① 目标：把对手生命降到 0", body: "你是左边的旅行者，对手在右边。先看中间的意图：它告诉你点击“结束回合”后，对手会做什么。", example: "显示“攻击 6”：本回合结束时，将有 6 点攻击，护盾先抵挡。" },
    { title: "② 能量决定这回合能打几张", body: "卡牌左上角是费用。点一张手牌，再点底部“打出”。能量足够且满足卡牌条件时，一回合可以连续打多张。左右滑动能看到全部手牌。", example: "现在有 3 能量，打出一张费用 1 的“敲击”后，还剩 2 能量。" },
    { title: "③ 攻击与护盾怎么选", body: "攻击降低对手生命；护盾先抵挡攻击，剩余伤害才扣生命。先判断能否击败对手，再决定是否需要防护。", example: "对手攻击 6，你有 5 护盾：只损失 1 生命。你的剩余护盾在下个玩家回合开始清除。对方刚获得的护盾会留到你行动，再于下一敌方阶段清除。" },
    { title: "④ 回合结束，会换一手牌", body: "点“结束回合”后，对手行动；没打出的手牌会进入弃牌堆，标有“保留”的除外。下回合恢复能量、抽新牌；抽牌堆用完，弃牌会洗回来，所以弃掉不等于永久失去。", example: "例如手里剩两张普通“敲击”：结束回合后它们进入弃牌堆，不会一直留在手中。城门胜利后，选奖励牌并确认加入。" },
  ] },
  { id: "cards", label: "卡牌词典", pages: [
    { title: "过载：现在多用，下回合少用", body: "“借火”立刻获得能量，代价是下回合锁定一部分能量。状态栏会显示锁定数，只持续下一回合。", example: "容量 3、锁定 2：下回合开始只能恢复 1 能量。" },
    { title: "成长：为后面的回合做准备", body: "成长提高本场能量容量，从下一回合起生效，不会立刻补满能量。下一场战斗重新开始。", example: "本回合用“引根”让容量从 3 到 4，下回合才可以恢复 4 能量。" },
    { title: "保留、消耗与牌组", body: "保留牌可以留到之后再打；“候机”让另一张手牌保留一回合。消耗牌本场暂时移出，下场回来。买到或奖励的新牌加入牌组，不会立刻进手牌。", example: "想找某张牌：点“牌组”查看全部牌；战斗中可点抽牌堆、弃牌堆和消耗区。" },
  ] },
  { id: "money", label: "金币与投资", pages: [
    { title: "金币要分给现在和之后", body: "营地先决定留多少现金买牌、补给，多少放进随行投资。可以参与，也可以选 0。两边共用同一份金币。", example: "有 72 金币，投入 20 后，还能拿 52 买牌或升级；买一张牌要 25，升级要 20，补生命要 10。" },
    { title: "每处营地，都能重新安排", body: "把金币换成随历史价格变化的份额。中途和最后营地都可以新投入或追加，也能决定原来的份额继续持有、取回一半或全部取回。", example: "第一次选 0 不会失去机会：到了中途营地仍可投入 20。新投入用手里现有金币，取回和投入都按下一次报价执行。" },
    { title: "补给预算只是你的备忘", body: "可以记下希望留作补给的金额。它不扣钱、不锁钱，也不会阻止你消费；购买前会提示是否低于计划，随时能修改。", example: "计划留 10 金币，买牌后只剩 7：可以改计划，也可以先不买。" },
  ] },
  { id: "archive", label: "历史档案", pages: [
    { title: "买一次，之后免费更新", body: "花 4 金币解锁历史走势和同期市场对照。任何营地都可先买资料再安排投资；之后到新营地，会加入已经走过的新一段行情，不重复收费。", example: "在营地“档案”页点“翻开已购买的历史档案”，看清资料更新到了哪一天。档案帮助比较过去，不会提前揭晓后面的价格。" },
  ] },
  { id: "profile", label: "我的交易风格", pages: [
    { title: "怎样从冒险形成画像", body: "报告回看：你怎样分配金币、是否查看资料、看到变化后怎样安排持有与回收。每条线索都能点开看当时的选择和条件。", example: "“留了多少现金”是事实；只有买过资料，不能自动说你擅长研究。没有发生的选择会保留为未知。" },
    { title: "战斗与研究，各自说明什么", body: "选牌、连招和路线显示这局的游戏打法；资金取舍与资料使用形成本局交易线索。研究练习再补充知识、核查过程和下一步帮助。", example: "营地或通关后点“我的交易风格”。这是本局画像，不是经过验证的固定人格类型。" },
  ] },
];

/** A single, re-openable rulebook. Each page is short enough for a phone. */
export function guideView(initial: GuideTopic = "battle"): HTMLElement {
  let topic = topics.find((item) => item.id === initial) ?? topics[0]!;
  let index = 0;
  const content = h("div", { class: "guide-page", "aria-live": "polite" });
  const tabs = new Map<GuideTopic, HTMLButtonElement>();
  const paint = (): void => {
    for (const [id, tab] of tabs) tab.setAttribute("aria-pressed", String(id === topic.id));
    const page = topic.pages[index]!;
    content.replaceChildren(h("p", { class: "eyebrow" }, `${index + 1} / ${topic.pages.length}`), h("h3", null, page.title), h("p", null, page.body), h("div", { class: "guide-example" }, page.example),
      h("div", { class: "button-row guide-paging" }, button("上一页", () => { index--; paint(); }, "small secondary", index === 0), button("下一页", () => { index++; paint(); }, "small", index === topic.pages.length - 1)));
  };
  const navigation = h("nav", { class: "guide-topics", "aria-label": "按主题查规则" }, topics.map((item) => {
    const tab = button(item.label, () => { topic = item; index = 0; paint(); }, "small secondary"); tabs.set(item.id, tab); return tab;
  }));
  paint();
  return h("div", { class: "guidebook" }, navigation, content);
}
