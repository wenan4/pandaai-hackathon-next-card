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
;const out=[];const errors=[];
 const saved=await page.evaluate(()=>Object.fromEntries(['nextcard:adventure:v0.4','nextcard:adventure:v0.4:seen-cases','nextcard:adventure:v0.4:funding-exposure'].map(k=>[k,localStorage.getItem(k)])));
 for(const size of [{width:360,height:740},{width:390,height:844}]){
  const ctx=await page.context().browser().newContext({viewport:size});const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));const measure=async label=>out.push({label,...await p.evaluate(()=>({w:innerWidth,h:innerHeight,docH:document.documentElement.scrollHeight,docW:document.documentElement.scrollWidth}))});
  try{
   await p.goto('http://127.0.0.1:4186/');await measure('fresh-home');await p.getByRole('button',{name:'只玩游戏',exact:true}).click();await measure('fresh-battle');await battle(p);await measure('fresh-reward');await p.locator('.reward-choices .game-card').first().click();await p.getByRole('button',{name:/^确认加入 /}).click();await measure('n2-first-arrangement');
   for(const id of ['cards','supplies','archive']){await p.locator('[data-focus-key="page-'+id+'"]').click();await measure('n2-uncommitted-'+id);}
   await p.locator('[data-focus-key="page-cards"]').click();await p.locator('[data-focus-key="buy-C08"]').click();await measure('uncommitted-purchase-confirm');await p.getByRole('button',{name:'先安排金币',exact:true}).click();await measure('cancel-to-arrange');
   await p.getByRole('button',{name:'我的交易风格',exact:true}).click();await measure('only-game-report');out.push({onlyGameText:await p.getByRole('main').innerText()});
  }finally{await ctx.close();}
 }
 const ctx=await page.context().browser().newContext({viewport:{width:360,height:740}});const p=await ctx.newPage();
 try{await p.goto('http://127.0.0.1:4186/');await p.evaluate(v=>{for(const[k,s]of Object.entries(v))if(s!==null)localStorage.setItem(k,s)},saved);await p.reload();await p.locator('[data-focus-key="resume"]').click();await p.getByRole('button',{name:'研究与下一步',exact:true}).click();await p.getByRole('button',{name:'打开资金安排台',exact:true}).click();await p.getByRole('button',{name:'下一步：判断采购',exact:true}).click();await p.getByRole('button',{name:'分步说明',exact:true}).click();out.push({label:'d1-help-final',...await p.evaluate(()=>({h:innerHeight,docH:document.documentElement.scrollHeight}))});await p.screenshot({path:'output/playwright/mobile-d1-help-final-360.png'});}finally{await ctx.close();}
 return {out,errors};
}
