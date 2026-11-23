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
;const out=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function measure(label){out.push({label,...await page.evaluate(()=>({h:innerHeight,docH:document.documentElement.scrollHeight,w:innerWidth,docW:document.documentElement.scrollWidth}))});}
 async function acceptBudget(){const confirm=page.getByRole('button',{name:'继续购买',exact:true});if(await confirm.count())await confirm.click();}
 await page.locator('[data-focus-key="page-supplies"]').click();const heal=page.locator('[data-focus-key="heal"]');if(await heal.isEnabled()){await heal.click();await acceptBudget();}
 await page.locator('[data-focus-key="page-cards"]').click();const card=page.locator('[data-focus-key="buy-C10"]');if(await card.count()){await card.click();await acceptBudget();}
 await page.locator('[data-focus-key="camp-continue"]').click();await page.getByRole('heading',{name:'选择接下来的路',exact:true}).waitFor();await measure('route5');await page.locator('[data-focus-key="route-moss"]').click();await measure('battle5');const b5=await battle(page);out.push({battle5steps:b5.steps.length});
 if(await page.locator('.reward-choices').count()){await page.locator('.reward-choices .game-card').first().click();await page.getByRole('button',{name:/^确认加入 /}).click();}
 await page.getByRole('heading',{name:'随行投资 · 这一站的变化',exact:true}).waitFor();await measure('n6-arrival');await page.locator('[data-focus-key="redeem-100"]').click();await page.getByRole('heading',{name:'这一站安排好了',exact:true}).waitFor();await measure('n6-settled');
 await page.locator('[data-focus-key="page-free"]').click();if(await page.locator('[data-focus-key="free-rest"]').isEnabled())await page.locator('[data-focus-key="free-rest"]').click();else await page.locator('[data-focus-key="free-upgrade"]').click();
 await page.locator('[data-focus-key="page-supplies"]').click();if(await page.locator('[data-focus-key="heal"]').isEnabled()){await page.locator('[data-focus-key="heal"]').click();await acceptBudget();}
 await page.locator('[data-focus-key="camp-continue"]').click();await measure('boss-start');out.push({boss:await page.getByRole('region').innerText()});await page.screenshot({path:'output/playwright/mobile-boss-360.png'});const boss=await battle(page);out.push({bossSteps:boss.steps.length});
 await page.getByRole('button',{name:'概览',exact:true}).waitFor();await measure('ending-profile');
 for(const label of ['概览','选择依据','研究与下一步','牌组账本']){await page.getByRole('button',{name:label,exact:true}).click();await measure('ending-'+label);}
 await page.getByRole('button',{name:'概览',exact:true}).click();await page.screenshot({path:'output/playwright/mobile-completed-profile-360.png'});out.push({ending:await page.getByRole('main').innerText(),errors});return out;
}
