async (page) => {
 const battle=async page => {
 page.setDefaultTimeout(5000);
 const steps=[];
 for(let n=0;n<90;n++){
  if(await page.getByRole('button',{name:'结束回合',exact:true}).count()===0)break;
  const arena=await page.getByRole('region').innerText();
  const hp=[...arena.matchAll(/生命 (\d+) \/ (\d+) · 护盾 (\d+)/g)].map(x=>x.slice(1).map(Number));
  const energy=Number((await page.getByText('现在可用能量',{exact:true}).locator('..').innerText()).match(/\d+/)?.[0]);
  const incoming=Number(arena.match(/(?:本回合结束|对方下一步)\s*攻击 (\d+)/)?.[1]??0);
  const labels=await page.getByRole('button').evaluateAll(es=>es.map(e=>({label:e.getAttribute('aria-label')??'',disabled:e.disabled})).filter(x=>x.label.includes('，费用 ')));
  const allowed=labels.filter(c=>!c.disabled&&Number(c.label.match(/费用 (\d+)/)?.[1]??99)<=energy);
  const find=name=>allowed.find(c=>c.label.startsWith(name+'，'));
  let card;
  if((hp[1]?.[0]??999)+(hp[1]?.[2]??0)<=6)card=find('敲击');
  if(!card&&find('余烬')&&find('连刃')&&energy>=2)card=find('余烬');
  if(!card&&incoming-(hp[0]?.[2]??0)>=4)card=find('临时壁垒')??find('格挡')??find('缓步');
  if(!card&&energy<=1&&labels.some(c=>!c.label.startsWith('借火')&&c.label.includes('造成')))card=find('借火');
  if(!card)card=find('参天一击')??find('树冠守望')??find('引雷')??find('连刃')??find('敲击')??(energy>=2?find('整理'):undefined)??find('缓步');
  if(card){await page.getByRole('button',{name:card.label,exact:true}).first().click();const play=page.getByRole('button',{name:'打出',exact:true});if(await play.isEnabled()){await play.click();steps.push(card.label.split('，')[0]);}else{await page.getByRole('button',{name:'结束回合',exact:true}).click();steps.push('结束');}}
  else {await page.getByRole('button',{name:'结束回合',exact:true}).click();steps.push('结束');}
 }
 return {steps,main:await page.getByRole('main').innerText()};
}
;const out=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const measure=async label=>out.push({label,...await page.evaluate(()=>({h:innerHeight,docH:document.documentElement.scrollHeight,w:innerWidth,docW:document.documentElement.scrollWidth}))});
 const state=()=>page.evaluate(()=>{const {run}=JSON.parse(localStorage.getItem('nextcard:adventure:v0.4'));return {node:run.node,cash:run.wallet.cashCents,shares:run.wallet.shareUnits,invested:run.wallet.investedCents,basis:run.wallet.costBasisCents,reserved:run.wallet.reservedCents,opens:run.history.filter(e=>e.action==='open-archive').map(e=>e.node),purchases:run.wallet.ledger.filter(e=>e.description.includes('档案')).length}});
 await page.locator('[data-focus-key="page-free"]').click();if(await page.locator('[data-focus-key="free-rest"]').isEnabled())await page.locator('[data-focus-key="free-rest"]').click();else await page.locator('[data-focus-key="free-upgrade"]').click();
 await page.locator('[data-focus-key="page-supplies"]').click();if(await page.locator('[data-focus-key="heal"]').isEnabled())await page.locator('[data-focus-key="heal"]').click();
 await page.locator('[data-focus-key="camp-continue"]').click();await page.getByRole('heading',{name:'选择接下来的路',exact:true}).waitFor();await page.locator('[data-focus-key="route-moss"]').click();await battle(page);await page.locator('.reward-choices .game-card').first().click();await page.getByRole('button',{name:/^确认加入 /}).click();await page.getByRole('heading',{name:'这一站：追加、持有或取回',exact:true}).waitFor();await measure('n6-arrival');out.push({beforeArchive:await state()});
 await page.locator('[data-focus-key="page-archive"]').click();await page.getByText('翻开已购买的历史档案',{exact:true}).click();await measure('n6-archive');out.push({archive:await page.locator('[data-archive-view]').innerText(),afterArchive:await state()});
 await page.locator('[data-focus-key="page-allocation"]').click();await page.locator('[data-focus-key="additional-entry-amount"]').fill('10');await page.locator('[data-focus-key="redemption-percent"]').selectOption('50');await measure('n6-combined-preview');await page.screenshot({path:'output/playwright/followup-n6-combined-360.png'});await page.locator('[data-focus-key="camp-allocation-submit"]').click();await page.getByRole('heading',{name:'这一站安排好了',exact:true}).waitFor();out.push({combinedFilled:await state(),receipt:await page.getByRole('main').innerText()});
 await page.locator('[data-focus-key="page-free"]').click();if(await page.locator('[data-focus-key="free-rest"]').isEnabled())await page.locator('[data-focus-key="free-rest"]').click();else await page.locator('[data-focus-key="free-upgrade"]').click();await page.locator('[data-focus-key="page-supplies"]').click();if(await page.locator('[data-focus-key="heal"]').isEnabled())await page.locator('[data-focus-key="heal"]').click();await page.locator('[data-focus-key="camp-continue"]').click();await battle(page);await page.getByRole('button',{name:'概览',exact:true}).waitFor();await measure('completed-late-profile');out.push({profile:await page.getByRole('main').innerText()});
 await page.getByRole('button',{name:'研究与下一步',exact:true}).click();await page.getByRole('button',{name:'打开资金安排台',exact:true}).click();await measure('funding-intro');out.push({fundingIntro:await page.getByRole('main').innerText()});await page.screenshot({path:'output/playwright/followup-funding-intro-360.png'});return {out,errors};
}
