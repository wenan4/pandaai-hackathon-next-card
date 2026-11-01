import type { GameEvent, Run, RunSource } from './types';

export interface DecisionInsight {
  status: 'observed' | 'unobserved' | 'disabled';
  title: string;
  brief: string;
  detail: string;
  evidenceIds: string[];
}

export interface DecisionSummary {
  funding: DecisionInsight;
  response: DecisionInsight;
  information: DecisionInsight;
  source: RunSource;
  boundary: string;
}

const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const hasShares = (value: unknown): boolean => typeof value === 'string' && /^\d+$/.test(value) && /[1-9]/.test(value);
const coins = (value: number): string => (value / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
const eventData = (event: GameEvent, key: string): unknown => event.data?.[key];

function fundingInsight(run: Run, history: GameEvent[]): DecisionInsight {
  const later = history.filter((event) => event.type === 'choice' && event.action === 'submit-redemption' && eventData(event, 'additionalEntryCents') !== undefined);
  if (later.length) {
    const initial = history.find((event) => event.type === 'choice' && event.action === 'submit-entry');
    const choices = [...(initial ? [initial] : []), ...later];
    const records = choices.map((event) => {
      const amount = eventData(event, event.action === 'submit-entry' ? 'amountCents' : 'additionalEntryCents');
      const cash = event.snapshot?.cashCents;
      const place = event.action === 'submit-entry' ? '首营地' : event.node === 'N4' ? '中途营地' : event.node === 'N6' ? '最后营地' : '当时';
      if (!isAmount(amount)) return { event, observed: false, text: `${place}参与金额未完整记录` };
      if (!isAmount(cash) || amount > cash) return { event, observed: false, text: `${place}提交${event.action === 'submit-entry' ? '参与' : '追加'} ${coins(amount)} 金币，当时可用金额未知` };
      if (cash === 0) return { event, observed: false, text: `${place}当时没有可用金币` };
      return { event, observed: true, text: `${place}可用 ${coins(cash)} 金币，选择${event.action === 'submit-entry' ? '参与' : '追加'} ${coins(amount)} 金币，预留后剩 ${coins(cash - amount)} 金币` };
    });
    const executed = run.wallet?.investedCents;
    const pending = run.phase === 'market' && run.market?.order?.kind === 'sell' ? run.market.order.additionalEntryCents ?? 0 : 0;
    const total = isAmount(executed) ? `累计已执行 ${coins(executed)} 金币` : '已执行总额未知';
    const waiting = isAmount(pending) && pending > 0 ? `；${coins(pending)} 金币已预留、待下一报价执行` : '';
    return { status: records.some((record) => record.observed) ? 'observed' : 'unobserved', title: '各营地的参与安排', brief: `${total}${waiting}`,
      detail: `${initial ? '' : '首次参与记录未完整保存。'}${records.map((record) => record.text).join('；')}。${total}${waiting}。回收款不能提前用于预留；选择原因未知。`,
      evidenceIds: records.map((record) => record.event.id) };
  }
  const index = history.findIndex((event) => event.type === 'choice' && event.action === 'submit-entry');
  const choice = history[index];
  if (!choice) return { status: 'unobserved', title: '参与与留用', brief: '尚无参与安排', detail: '尚无已提交的参与安排，暂时无法描述这次资金取舍。', evidenceIds: [] };
  const amount = eventData(choice, 'amountCents');
  const cash = choice.snapshot?.cashCents;
  if (!isAmount(amount)) return { status: 'unobserved', title: '参与与留用', brief: '参与金额未记录', detail: '参与记录缺少金额，暂时无法描述这次资金取舍。', evidenceIds: [choice.id] };
  if (!isAmount(cash) || amount > cash) return { status: 'unobserved', title: '参与与留用', brief: `参与 ${coins(amount)} 金币，留用未知`, detail: `记录显示提交 ${coins(amount)} 金币参与；当时可用金币不明，无法还原取舍。`, evidenceIds: [choice.id] };
  if (cash === 0) return { status: 'unobserved', title: '当时没有可用金币', brief: '参与时没有可用金币', detail: '提交参与时可用金币为 0，这次没有形成有区别的金额选择。原因仍不清楚。', evidenceIds: [choice.id] };

  const earlierPurchases = history.slice(0, index).filter((event) => event.type === 'choice' && ['buy-card', 'heal', 'upgrade-card', 'buy-archive'].includes(event.action));
  const amounts = earlierPurchases.map((event) => eventData(event, 'amountCents'));
  const knownSpending = amounts.every(isAmount) ? amounts.reduce<number>((sum, value) => sum + (value as number), 0) : null;
  const spendText = knownSpending !== null && Number.isSafeInteger(knownSpending) && knownSpending > 0
    ? `此前已记录的购买和补给共花费 ${coins(knownSpending)} 金币。` : '';
  const title = amount === 0 ? '这次保留了可用金币' : amount === cash ? '这次选择全部参与' : '参与同时留出了金币';
  return { status: 'observed', title, brief: `参与 ${coins(amount)} 金币，留下 ${coins(cash - amount)} 金币`, detail: `${spendText}提交参与时可用 ${coins(cash)} 金币，选择参与 ${coins(amount)} 金币，留下 ${coins(cash - amount)} 金币可用。选择原因仍未知。`,
    evidenceIds: [...(spendText ? earlierPurchases.map((event) => event.id) : []), choice.id] };
}

function responseInsight(history: GameEvent[]): DecisionInsight {
  const choices = history.filter((event) => event.type === 'choice' && event.action === 'submit-redemption');
  const valid = choices.filter((event) => {
    const percent = eventData(event, 'percent');
    const additional = eventData(event, 'additionalEntryCents');
    const cash = event.snapshot?.cashCents;
    return (hasShares(event.snapshot?.shareUnits) && (percent === 0 || percent === 50 || percent === 100))
      || (isAmount(additional) && additional > 0 && isAmount(cash) && additional <= cash);
  });
  if (!valid.length) return { status: 'unobserved', title: '面对变化的安排', brief: '尚无持有后的自主选择', detail: choices.length ? '尚无可确认的持有份额时的自主回收选择；这不能说明偏好。' : '尚无持有份额后的自主回收选择，暂时无法描述面对变化时的安排。', evidenceIds: choices.map((event) => event.id) };
  const text = valid.map((event) => {
    const percent = eventData(event, 'percent');
    const action = percent === 0 ? '选择继续持有' : percent === 50 ? '选择回收一半份额' : '选择全部回收份额';
    const validRedemption = hasShares(event.snapshot?.shareUnits) && (percent === 0 || percent === 50 || percent === 100);
    const reference = event.snapshot?.referenceValueCents;
    const basis = event.snapshot?.costBasisCents;
    const position = event.node === 'N4' ? '中途营地' : event.node === 'N6' ? '最后营地' : '当时';
    const added = eventData(event, 'additionalEntryCents');
    const cash = event.snapshot?.cashCents;
    const extra = isAmount(added) && added > 0 && isAmount(cash) && added <= cash ? `；选择预留追加 ${coins(added)} 金币` : '';
    if (!validRedemption) return `${position}：${hasShares(event.snapshot?.shareUnits) ? '回收比例未完整记录' : '当时没有可确认的持有份额'}${extra}`;
    if (!isAmount(reference) || !isAmount(basis)) return `${position}：${action}，当时参考价值或成本未完整记录${extra}`;
    const difference = reference - basis;
    const change = difference === 0 ? '与当时份额成本相同' : `${difference > 0 ? '高于' : '低于'}当时份额成本 ${coins(Math.abs(difference))} 金币`;
    return `${position}：参考价值 ${coins(reference)} 金币，${change}；${action}${extra}`;
  });
  const incomplete = valid.length < choices.length ? '另有选择记录缺少份额或比例，无法判断。' : '';
  const brief = valid.map((event) => {
    const place = event.node === 'N4' ? '中途' : event.node === 'N6' ? '最后营地' : '当时';
    const pct = eventData(event, 'percent');
    const original = hasShares(event.snapshot?.shareUnits) && (pct === 0 || pct === 50 || pct === 100) ? pct === 0 ? '继续持有' : pct === 50 ? '选择回收一半' : '选择全部回收' : '';
    const added = eventData(event, 'additionalEntryCents'); const cash = event.snapshot?.cashCents;
    const extra = isAmount(added) && added > 0 && isAmount(cash) && added <= cash ? `${original ? '并' : '选择'}追加 ${coins(added)} 金币` : '';
    return `${place}${original}${extra}`;
  }).join('；');
  return { status: 'observed', title: '已发生的份额安排', brief, detail: `${text.join('；')}。${incomplete}这是提交时的选择，不代表回收已到账；原因与感受不能由此推断。`, evidenceIds: valid.map((event) => event.id) };
}

function informationInsight(history: GameEvent[]): DecisionInsight {
  const opened = history.find((event) => event.type === 'choice' && event.action === 'open-archive' && event.snapshot?.archiveOwned !== false);
  const bought = history.find((event) => event.type === 'choice' && event.action === 'buy-archive');
  if (!opened && !bought) return { status: 'unobserved', title: '资料使用', brief: '尚无档案使用记录', detail: '尚无购买或打开历史档案的记录，不能据此推断兴趣或理解。', evidenceIds: [] };
  const amount = bought && eventData(bought, 'amountCents');
  const paid = isAmount(amount) ? `购买历史档案花费 ${coins(amount)} 金币。` : bought ? '记录显示购买了历史档案，但花费未完整记录。' : '';
  if (opened) return { status: 'observed', title: '打开过历史资料', brief: bought ? '购买并打开档案' : '打开过历史档案', detail: `${paid}本局记录显示打开过历史档案；打开不代表已经理解，查看原因也未知。`, evidenceIds: [bought?.id, opened.id].filter((id): id is string => !!id) };
  return { status: 'observed', title: '购买过历史档案', brief: '购买档案，未见打开记录', detail: `${paid}本局未保存打开档案的记录；不能据此判断是否感兴趣。`, evidenceIds: bought ? [bought.id] : [] };
}

/** Presentation of this run's saved choices; no profile mutation, market fetch or prediction. */
export function decisionSummary(run: Run): DecisionSummary {
  const boundary = '这些线索只描述本局选择，不能推断稳定交易人格、现实风险承受力或能力；战斗打法不参与金融观察。';
  if (!run.observationEnabled) {
    const disabled = (title: string): DecisionInsight => ({ status: 'disabled', title, brief: '观察未启用或已撤销', detail: '本局观察未启用或已撤销，不生成经营观察。', evidenceIds: [] });
    return { funding: disabled('参与与留用'), response: disabled('面对变化的安排'), information: disabled('资料使用'), source: run.source, boundary };
  }
  const history = run.history ?? [];
  return { funding: fundingInsight(run, history), response: responseInsight(history), information: informationInsight(history), source: run.source, boundary };
}
