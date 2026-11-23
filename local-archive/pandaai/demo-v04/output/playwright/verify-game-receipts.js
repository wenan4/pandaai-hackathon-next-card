async page => {
  // Restore an exact copy of a prior normal-button test save into an isolated
  // context. No values are invented; the source context is read-only.
  const source=page.context().pages().find(p=>p.url().startsWith('http://127.0.0.1:4186/'));
  const key='nextcard:adventure:v0.4';
  const readSource=()=>source.evaluate(key=>Object.fromEntries([key,key+':seen-cases',key+':funding-exposure'].map(k=>[k,localStorage.getItem(k)])),key);
  const original=await readSource(), originalRun=JSON.parse(original[key]).run;
  const check=(value,message)=>{if(!value)throw new Error(message);};
  const results=[];
  const modes=originalRun.node==='N2'?['shop']:originalRun.hp===originalRun.maxHp?['full-health']:['free-rest','paid-heal'];
  for(const mode of modes){
    const context=await page.context().browser().newContext({viewport:{width:390,height:844}}),p=await context.newPage();
    try{
      await p.goto('http://127.0.0.1:4186/',{waitUntil:'networkidle'});
      await p.evaluate(values=>{for(const [k,v] of Object.entries(values))if(v!==null)localStorage.setItem(k,v);},original);
      await p.reload({waitUntil:'networkidle'});await p.getByRole('button',{name:'继续上次旅程',exact:true}).click();
      const read=()=>p.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
      if(mode==='shop'){
        const select=p.getByLabel('选择要升级的牌'),beforeLabel=await select.locator('option:checked').innerText();
        await p.getByRole('button',{name:'确认升级',exact:true}).click();
        const upgradeText=await p.locator('[data-game-receipt=shop]').innerText(),nextLabel=await select.locator('option:checked').innerText();
        check(beforeLabel.includes('第 2 张')&&nextLabel.includes('第 3 张')&&upgradeText.includes('第 2 张'),'unstable duplicate-card index');
        check(upgradeText.includes('20 金币')&&upgradeText.includes('32 金币'),'upgrade result amounts');
        await p.waitForFunction(()=>{const r=document.querySelector('[data-game-receipt=shop]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;});
        await p.getByRole('button',{name:'购买档案',exact:true}).click();
        const archiveText=await p.locator('[data-game-receipt=shop]').innerText();check(archiveText.includes('4 金币')&&archiveText.includes('28 金币'),'archive receipt');
        await p.locator('.item').filter({has:p.getByText('余烬',{exact:true})}).getByRole('button',{name:'购买',exact:true}).click();
        const buyText=await p.locator('[data-game-receipt=shop]').innerText();check(buyText.includes('余烬')&&buyText.includes('25 金币')&&buyText.includes('3 金币'),'card receipt');
        const beforeFailure=await read();await p.locator('.item').filter({has:p.getByText('参天一击',{exact:true})}).getByRole('button',{name:'尝试购买',exact:true}).click();
        const afterFailure=await read();check(beforeFailure.run.wallet.cashCents===afterFailure.run.wallet.cashCents&&beforeFailure.run.deck.length===afterFailure.run.deck.length,'failed purchase changed cash/deck');
        check(await p.locator('[data-game-receipt]').count()===0,'failure retained old success receipt');
        results.push({mode,beforeLabel,nextLabel,upgradeText,archiveText,buyText,failureSpentNothing:true});
      }else{
        if(originalRun.camp.decision!=='settled'){await p.getByRole('button',{name:'继续持有',exact:true}).click();await p.getByText('契约已结算',{exact:true}).waitFor();}
        if(mode==='full-health'){
          const before=await read(),rest=p.getByRole('button',{name:'休息，恢复 0 生命',exact:true});check(await rest.isDisabled(),'full-health rest enabled');
          check(!before.run.camp.freeChoiceUsed,'opportunity spent before action');await p.getByRole('button',{name:'免费升级所选牌',exact:true}).click();
          const after=await read(),receipt=await p.locator('[data-game-receipt=free]').innerText();
          check(after.run.camp.freeChoiceUsed&&after.run.wallet.cashCents===before.run.wallet.cashCents,'free upgrade cost or opportunity wrong');
          results.push({mode,restDisabled:true,receipt,cashUnchanged:true});
        }else{
          const before=await read(),gain=Math.min(mode==='free-rest'?6:10,before.run.maxHp-before.run.hp);
          await p.getByRole('button',{name:mode==='free-rest'?`休息，恢复 ${gain} 生命`:'补充生命',exact:true}).click();
          const after=await read(),receipt=await p.locator(`[data-game-receipt=${mode==='free-rest'?'free':'shop'}]`).innerText();
          check(after.run.hp-before.run.hp===gain&&receipt.includes(`恢复 ${gain} 点`),'healing amount mismatch');
          check(before.run.wallet.cashCents-after.run.wallet.cashCents===(mode==='free-rest'?0:1000),'healing cost mismatch');
          check(after.profile.knowledge_evidence.length===0&&after.profile.funding_attempts.length===0&&after.profile.research_process.length===0,'play-only observes research');
          await p.screenshot({path:`output/playwright/${mode}-receipt.png`,fullPage:true});
          results.push({mode,gain,receipt,onlyPlayObservationCount:0});
        }
      }
    }finally{await context.close();}
  }
  check(JSON.stringify(await readSource())===JSON.stringify(original),'source test save was changed');
  return {isolatedCopies:true,sourceUnchanged:true,results};
}
