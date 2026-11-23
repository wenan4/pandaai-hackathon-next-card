async page => {
 const base='http://127.0.0.1:4186/',key='nextcard:adventure:v0.4',results=[];
 const check=(v,m)=>{if(!v)throw new Error(m);};
 for(const mode of ['own-modal','external-after-lock']){
  const context=await page.context().browser().newContext({viewport:{width:390,height:844}}),p=await context.newPage(),errors=[];let release=()=>{};
  p.on('pageerror',e=>errors.push(e.message));
  try{
   await p.goto(base,{waitUntil:'networkidle'});await p.getByRole('button',{name:'开始旅程 · 生成本局观察',exact:true}).click();
   for(let turn=0;await p.getByRole('button',{name:'结束回合',exact:true}).count();turn++){check(turn<20,'teaching defeat stalled');await p.getByRole('button',{name:'结束回合',exact:true}).click();}
   const read=()=>p.evaluate(k=>({save:JSON.parse(localStorage.getItem(k)),seen:JSON.parse(localStorage.getItem(k+':seen-cases')||'[]')}),key);
   const openHistory=async()=>{await p.getByRole('button',{name:'目标与帮助',exact:true}).click();await p.getByRole('button',{name:'历史比较',exact:true}).click();await p.getByRole('button',{name:'自主尝试',exact:true}).click();await p.getByRole('button',{name:'完成',exact:true}).click();await p.getByRole('button',{name:'打开历史对照台',exact:true}).click();};
   await openHistory();await p.getByLabel('查看的历史片段').selectOption('lantern-c');
   let arrived;let gate=new Promise(r=>{release=r;}),held=new Promise(r=>{arrived=r;});
   await p.route('**/research/lantern-c.json',async route=>{arrived();await gate;await route.continue();});
   await p.getByRole('button',{name:'锁定并查看同期资料',exact:true}).click();await held;
   const locked=(await read()).save.profile.research_process.at(-1);check(locked.caseId==='lantern-c'&&!locked.priorExposure&&!locked.shown,'unexpected locked fixture');
   if(mode==='own-modal')await p.getByRole('button',{name:'设置',exact:true}).click();else await p.getByRole('button',{name:'评委面板',exact:true}).click();
   let response=p.waitForResponse(r=>r.url().endsWith('/research/lantern-c.json'));release();await response;await p.waitForLoadState('networkidle');await p.unroute('**/research/lantern-c.json');
   let current=await read(),attempt=current.save.profile.research_process.find(a=>a.id===locked.id);
   check(!attempt.shown&&!current.seen.includes('lantern-c'),'hidden or abandoned primary was exposed');
   if(mode==='own-modal'){
    check(await p.getByText('案例固定日程盈亏',{exact:true}).count()===0,'new data drawn behind modal');
    await p.getByRole('button',{name:'完成',exact:true}).click();await p.getByLabel('本案例结果相对同期基准').waitFor();
    current=await read();attempt=current.save.profile.research_process.find(a=>a.id===locked.id);
    check(!!attempt.shown&&attempt.priorExposure===locked.priorExposure&&!attempt.exposedCaseIdsAfterLock,'own reveal polluted locked prior');
   }else{
    gate=new Promise(r=>{release=r;});held=new Promise(r=>{arrived=r;});
    await p.route('**/stages/lantern-d/t1.json',async route=>{arrived();await gate;await route.continue();});
    await p.getByRole('button',{name:'打开模拟对照',exact:true}).click();await held;await p.getByRole('button',{name:'设置',exact:true}).click();
    response=p.waitForResponse(r=>r.url().endsWith('/stages/lantern-d/t1.json'));release();await response;await p.waitForLoadState('networkidle');
    current=await read();attempt=current.save.profile.research_process.find(a=>a.id===locked.id);
    check(!attempt.exposedCaseIdsAfterLock&&!current.seen.includes('lantern-d'),'unshown simulation registered exposure');
    check(!(await p.locator('main').innerText()).includes('当前停在回收选择之前'),'simulation drawn behind modal');
    await p.getByRole('button',{name:'完成',exact:true}).click();await p.getByText(/当前停在回收选择之前/).waitFor();
    current=await read();attempt=current.save.profile.research_process.find(a=>a.id===locked.id);
    check(attempt.exposedCaseIdsAfterLock?.includes('lantern-d')&&!attempt.priorExposure&&!attempt.shown,'external exposure did not preserve lock facts');
    check(JSON.stringify(attempt.schedule)===JSON.stringify(locked.schedule)&&attempt.initialClaim===locked.initialClaim,'external exposure rewrote claim/schedule');
    await p.reload({waitUntil:'networkidle'});await p.getByRole('button',{name:'查看上次旅程',exact:true}).click();await p.getByRole('button',{name:'打开历史对照台',exact:true}).click();
    await p.getByRole('button',{name:'继续加载已锁定资料',exact:true}).click();await p.getByLabel('本案例结果相对同期基准').waitFor();
   }
   const number=async label=>Number((await p.getByText(label,{exact:true}).locator('..').innerText()).match(/[-+]?\d[\d,]*(?:\.\d+)?/)[0].replaceAll(',',''));
   const asset=await number('案例固定日程盈亏'),benchmark=await number('同期基准盈亏');
   await p.getByLabel('本案例结果相对同期基准').selectOption(asset===benchmark?'equal':asset>benchmark?'outperform':'underperform');await p.getByLabel('这次主要依据什么？').selectOption('根据同日期的数字比较');await p.getByRole('button',{name:'提交这次研究',exact:true}).click();
   current=await read();attempt=current.save.profile.research_process.find(a=>a.id===locked.id);const evidence=current.save.profile.knowledge_evidence.filter(e=>e.dimension==='K1').at(-1);
   check(attempt.id===locked.id&&attempt.priorExposure===locked.priorExposure&&attempt.submitted,'locked identity lost');
   check(evidence.correct&&evidence.counted===(mode==='own-modal')&&evidence.independent===(mode==='own-modal'),'incorrect independent-evidence eligibility');
   check(errors.length===0,'page errors');
   results.push({mode,lockedId:locked.id,priorExposure:attempt.priorExposure,postLockCases:attempt.exposedCaseIdsAfterLock??[],correct:evidence.correct,counted:evidence.counted,independent:evidence.independent,exclusion:evidence.exclusion_reason,errors});
  }finally{release();await context.close();}
 }
 return{isolatedFreshGames:true,results};
}
