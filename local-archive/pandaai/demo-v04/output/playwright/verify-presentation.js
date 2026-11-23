async page => {
 const base='http://127.0.0.1:4186/',key='nextcard:adventure:v0.4',seenKey=key+':seen-cases';
 const playBattle=/* PUBLIC_BATTLE_HELPER */;
 const check=(v,m)=>{if(!v)throw new Error(m);},results=[];
 // Produce one authentic checkpoint entirely through normal buttons.
 const producer=await page.context().browser().newContext({viewport:{width:390,height:844}});let checkpoint;
 try{
  const p=await producer.newPage();await p.goto(base,{waitUntil:'networkidle'});await p.getByRole('button',{name:'开始旅程 · 生成本局观察',exact:true}).click();await playBattle(p);
  await p.getByRole('button',{name:/^连刃，费用 /}).click();await p.getByRole('button',{name:'确认加入 连刃',exact:true}).click();
  await p.locator('.item').filter({has:p.getByText('余烬',{exact:true})}).getByRole('button',{name:'购买',exact:true}).click();
  await p.getByLabel('参与金额（金币）').fill('20');await p.getByRole('button',{name:'确认参与 20 金币',exact:true}).click();await p.getByRole('button',{name:'继续前往岔路',exact:true}).click();await p.getByRole('button',{name:'选择这条路',exact:true}).nth(1).click();await playBattle(p);await p.getByRole('heading',{name:'把新牌带上旅程',exact:true}).waitFor();
  checkpoint=await p.evaluate(key=>Object.fromEntries([key,key+':seen-cases',key+':funding-exposure'].map(k=>[k,localStorage.getItem(k)])),key);
 }finally{await producer.close();}
 for(const mode of ['home','modal','simulated-hidden','judge-summary']){
  const context=await page.context().browser().newContext({viewport:{width:390,height:844}}),p=await context.newPage();let release=()=>{};const errors=[];p.on('pageerror',e=>errors.push(e.message));
  try{
   await p.goto(base,{waitUntil:'networkidle'});await p.evaluate(values=>{for(const[k,v]of Object.entries(values))if(v!==null)localStorage.setItem(k,v);},checkpoint);await p.reload({waitUntil:'networkidle'});await p.getByRole('button',{name:'继续上次旅程',exact:true}).click();
   const snapshot=()=>p.evaluate(key=>({raw:localStorage.getItem(key),seen:localStorage.getItem(key+':seen-cases')}),key);
   if(mode==='judge-summary'){
    const before=await snapshot();await p.getByRole('button',{name:'评委面板',exact:true}).click();await p.getByRole('button',{name:'生成研究对照',exact:true}).click();await p.getByText('提示后完成',{exact:true}).waitFor();
    check(JSON.stringify(await snapshot())===JSON.stringify(before),'pure judge calculation marked exposure');results.push({mode,recordsUnchanged:true,errors});continue;
   }
   let arrived;const gate=new Promise(r=>{release=r;}),held=new Promise(r=>{arrived=r;});
   await p.route('**/stages/**/t1.json',async route=>{arrived();await gate;await route.continue();});
   await p.getByRole('button',{name:'这次不拿牌',exact:true}).click();await held;const pending=await snapshot(),state=JSON.parse(pending.raw);
   if(mode==='home')await p.getByRole('button',{name:'回到冒险首页',exact:true}).click();
   if(mode==='modal')await p.getByRole('button',{name:'设置',exact:true}).click();
   if(mode==='simulated-hidden')await p.evaluate(()=>{window.__qaVisibility='hidden';Object.defineProperty(document,'visibilityState',{get:()=>window.__qaVisibility,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
   const response=p.waitForResponse(r=>r.url().endsWith('/t1.json'));release();await response;await p.waitForLoadState('networkidle');
   check(JSON.stringify(await snapshot())===JSON.stringify(pending),'hidden quote changed run or familiarity');
   if(mode==='home')await p.getByRole('button',{name:'继续上次旅程',exact:true}).click();
   if(mode==='modal')await p.getByRole('button',{name:'完成',exact:true}).click();
   if(mode==='simulated-hidden')await p.evaluate(()=>{window.__qaVisibility='visible';document.dispatchEvent(new Event('visibilitychange'));});
   await p.waitForFunction(k=>JSON.parse(localStorage.getItem(k)).run.node==='N4',key);
   const after=await snapshot(),save=JSON.parse(after.raw),seen=JSON.parse(after.seen||'[]');
   check(seen.includes(save.run.caseId),'visible reveal not registered');check(save.priorExposure===state.priorExposure,'natural reveal changed prior exposure');
   check(save.run.history.filter(e=>e.action==='apply-quote'&&e.data.stage==='t1').length===1,'quote applied more than once');check(errors.length===0,'page errors');
   results.push({mode,whileUnavailableRawUnchanged:true,resumedNode:save.run.node,seen,priorExposure:save.priorExposure,appliedOnce:true,errors});
  }finally{release();await context.close();}
 }
 return{isolatedContexts:true,checkpointFromNormalPlay:true,results};
}
