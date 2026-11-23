async (page) => {
 const saved=await page.evaluate(()=>Object.fromEntries(['nextcard:adventure:v0.4','nextcard:adventure:v0.4:seen-cases','nextcard:adventure:v0.4:funding-exposure'].map(k=>[k,localStorage.getItem(k)])));
 const out=[];const errors=[];
 for(const size of [{width:360,height:740},{width:390,height:844}]){
  const ctx=await page.context().browser().newContext({viewport:size});const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
  const measure=async label=>out.push({label,...await p.evaluate(()=>({w:innerWidth,h:innerHeight,docH:document.documentElement.scrollHeight,docW:document.documentElement.scrollWidth,modalScroll:document.querySelector('.modal')?document.querySelector('.modal').scrollHeight-document.querySelector('.modal').clientHeight:0}))});
  try{
   await p.goto('http://127.0.0.1:4186/');await p.evaluate(v=>{for(const [k,s]of Object.entries(v))if(s!==null)localStorage.setItem(k,s)},saved);await p.reload();await p.locator('[data-focus-key="resume"]').click();
   for(const label of ['概览','选择依据','研究与下一步','牌组账本']){await p.getByRole('button',{name:label,exact:true}).click();await measure('full-report-'+label);}
   await p.getByRole('button',{name:'研究与下一步',exact:true}).click();await p.getByRole('button',{name:'打开资金安排台',exact:true}).click();await measure('funding-plan');
   await p.getByRole('button',{name:'下一步：判断采购',exact:true}).click();await p.getByRole('button',{name:'分步说明',exact:true}).click();await measure('funding-step-help');
   await p.getByRole('button',{name:'可以支付',exact:true}).click();await p.getByRole('button',{name:'下一步：调整计划',exact:true}).click();await measure('funding-revision');await p.getByRole('button',{name:'提交判断并保存计划',exact:true}).click();await measure('funding-result');
   await p.getByRole('button',{name:/^(继续|复习) · 历史对照台$/}).click();await measure('history-setup');await p.getByRole('button',{name:'锁定并查看同期资料',exact:true}).click();await p.getByRole('heading',{name:'2 · 看同期数据',exact:true}).waitFor();await measure('history-data');
   await p.getByRole('button',{name:/^再查看另一段历史/}).click();await p.getByRole('heading',{name:'另一段历史',exact:true}).waitFor();await measure('history-other');await p.getByRole('button',{name:'下一步：作答',exact:true}).click();await p.getByRole('button',{name:'分步说明',exact:true}).click();await measure('history-step-help');
   await p.getByLabel('本案例结果相对同期基准').selectOption('equal');await p.getByLabel('另一段历史的结果相对第一段').selectOption('equal');await p.getByLabel('这些结果能说明什么？').selectOption('only_samples');await p.getByLabel('这次主要依据什么？').selectOption('仍不确定，想继续核查');await p.getByRole('button',{name:'提交这次研究',exact:true}).click();await measure('history-result');
   await p.screenshot({path:'output/playwright/mobile-research-final-'+size.width+'.png'});
   await p.getByRole('button',{name:'怎么玩',exact:true}).click();for(const topic of ['从零学战斗','卡牌词典','金币与投资','历史档案','我的交易风格']){await p.getByRole('button',{name:topic,exact:true}).last().click();let i=0;for(;;){await measure('guide-'+topic+'-'+(++i));const next=p.getByRole('button',{name:'下一页',exact:true});if(await next.isDisabled())break;await next.click();}}
  } finally {await ctx.close();}
 }
 const after=await page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),Object.keys(saved));
 return {out,errors,sourceUnchanged:JSON.stringify(saved)===JSON.stringify(after)};
}
