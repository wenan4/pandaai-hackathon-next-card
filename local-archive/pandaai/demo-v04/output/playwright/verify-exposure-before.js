async page => {
 const playBattle=/* PUBLIC_BATTLE_HELPER */;
 const results=[];
 for(const mode of ['judge-summary','home']){
  const context=await page.context().browser().newContext({viewport:{width:390,height:844}}),p=await context.newPage();
  try{
   await p.goto('http://127.0.0.1:4186/',{waitUntil:'networkidle'});await p.getByRole('button',{name:'开始旅程 · 生成本局观察',exact:true}).click();
   const read=()=>p.evaluate(()=>({save:JSON.parse(localStorage.getItem('nextcard:adventure:v0.4')),seen:JSON.parse(localStorage.getItem('nextcard:adventure:v0.4:seen-cases')||'[]')}));
   if(mode==='judge-summary'){
    await p.setViewportSize({width:1440,height:1000});
    const before=await read();await p.getByRole('button',{name:'评委面板',exact:true}).click();await p.getByRole('button',{name:'生成研究对照',exact:true}).click();await p.getByText('提示后完成',{exact:true}).waitFor();
    const after=await read(),section=p.getByRole('heading',{name:'模拟不同研究表现与帮助',exact:true}).locator('..');
    results.push({mode,before:before.seen,after:after.seen,visible:await section.innerText()});continue;
   }
   await playBattle(p);await p.getByRole('button',{name:/^连刃，费用 /}).click();await p.getByRole('button',{name:'确认加入 连刃',exact:true}).click();
   await p.locator('.item').filter({has:p.getByText('余烬',{exact:true})}).getByRole('button',{name:'购买',exact:true}).click();
   await p.getByLabel('参与金额（金币）').fill('20');await p.getByRole('button',{name:'确认参与 20 金币',exact:true}).click();await p.getByRole('button',{name:'继续前往岔路',exact:true}).click();await p.getByRole('button',{name:'选择这条路',exact:true}).nth(1).click();await playBattle(p);
   await p.getByRole('heading',{name:'把新牌带上旅程',exact:true}).waitFor();
   let release,arrived;const gate=new Promise(r=>{release=r;}),held=new Promise(r=>{arrived=r;});
   await p.route('**/stages/**/t1.json',async route=>{arrived();await gate;await route.continue();});
   const before=await read();await p.getByRole('button',{name:'这次不拿牌',exact:true}).click();await held;
   await p.getByRole('button',{name:'回到冒险首页',exact:true}).click();
   const response=p.waitForResponse(r=>r.url().endsWith('/t1.json'));release();await response;
   await p.waitForFunction(()=>JSON.parse(localStorage.getItem('nextcard:adventure:v0.4')).run.node==='N4');
   const after=await read();
   results.push({mode,caseId:after.save.run.caseId,before:before.seen,after:after.seen,node:after.save.run.node,lastStep:after.save.run.market.lastQuote.step,currentHeading:await p.getByRole('heading',{level:1}).innerText(),main:await p.getByRole('main').innerText()});
  }finally{await context.close();}
 }
 return{isolatedFreshGames:true,results};
}
