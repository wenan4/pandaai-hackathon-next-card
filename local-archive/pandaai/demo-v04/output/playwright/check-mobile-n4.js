async (page) => {
 const battle = async page => {
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
;
 const out=[];
 async function measure(label){out.push({label,...await page.evaluate(()=>({w:innerWidth,h:innerHeight,docH:document.documentElement.scrollHeight,docW:document.documentElement.scrollWidth,below:[...document.querySelectorAll('button')].filter(x=>x.getClientRects().length&&!x.closest('[hidden]')&&x.getBoundingClientRect().left<innerWidth&&x.getBoundingClientRect().right>0).map(x=>({text:x.textContent,bottom:Math.round(x.getBoundingClientRect().bottom)})).filter(x=>x.bottom>innerHeight+2)}))});}
 await page.reload();await page.locator('[data-focus-key="resume"]').click();
 for(const id of ['allocation','cards','supplies','archive','budget','insight']) {await page.locator('[data-focus-key="page-'+id+'"]').click();if(id==='archive')await page.getByText('翻开已购买的历史档案',{exact:true}).click();await measure('n2-'+id);}
 await page.locator('[data-focus-key="camp-continue"]').click();await page.getByRole('heading',{name:'选择接下来的路',exact:true}).waitFor();await measure('route3');
 await page.locator('[data-focus-key="page-supplies"]').click();await measure('roadside3');
 await page.locator('[data-focus-key="page-routes"]').click();await page.locator('[data-focus-key="route-pursuer"]').click();await measure('battle3');
 await battle(page);await measure('reward3');
 if(await page.locator('[data-focus-key="reward-C07"]').count())await page.locator('[data-focus-key="reward-C07"]').click();else await page.locator('.reward-choices .game-card').first().click();
 await page.getByRole('button',{name:/^确认加入 /}).click();await page.getByRole('heading',{name:'随行投资 · 这一站的变化',exact:true}).waitFor();await measure('n4-arrival');
 await page.screenshot({path:'output/playwright/mobile-n4-360.png'});
 for(const id of ['cards','supplies','free','archive','budget','insight','allocation']){await page.locator('[data-focus-key="page-'+id+'"]').click();await measure('n4-'+id);}
 await page.locator('[data-focus-key="redeem-50"]').click();await page.getByRole('heading',{name:'这一站安排好了',exact:true}).waitFor();await measure('n4-settled');
 await page.locator('[data-focus-key="page-free"]').click();const rest=page.locator('[data-focus-key="free-rest"]');if(await rest.isEnabled())await rest.click();else await page.locator('[data-focus-key="free-upgrade"]').click();await measure('n4-free-receipt');
 return out;
}
