async page => {
  const base='http://127.0.0.1:4186/',key='nextcard:adventure:v0.4';
  const check=(v,m)=>{if(!v)throw new Error(m);},results=[];
  const playBattle=/* PUBLIC_BATTLE_HELPER */;
  for(const mode of ['shares','zero','skip']){
    const context=await page.context().browser().newContext({viewport:{width:360,height:800}}),p=await context.newPage(),errors=[];
    p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(8000);
    try{
      await p.goto(base,{waitUntil:'networkidle'});await p.getByRole('button',{name:'只玩游戏',exact:true}).click();
      const raw=()=>p.evaluate(k=>localStorage.getItem(k),key),read=async()=>JSON.parse(await raw());
      if(mode==='zero'){
        let count=0;while(await p.getByRole('button',{name:'结束回合',exact:true}).count()){await p.getByRole('button',{name:'结束回合',exact:true}).click();check(++count<=20,'zero-share defeat stalled');}
        await p.getByRole('heading',{name:'战斗失败，旅程暂告一段落',exact:true}).waitFor();const s=await read();
        check(s.run.phase==='ended'&&s.run.market.pending===null&&s.run.wallet.shareUnits==='0','zero shares unexpectedly wait');
        results.push({mode,explicitDefeatReport:true,pending:null,errors});continue;
      }
      await playBattle(p);
      const rewardBefore=await raw(),rewardState=JSON.parse(rewardBefore).run;
      if(mode==='skip'){
        await p.getByRole('button',{name:'这次不拿牌',exact:true}).click();const after=(await read()).run;
        check(after.node==='N2'&&after.deck.length===rewardState.deck.length&&after.wallet.cashCents===rewardState.wallet.cashCents,'skip changed reward value');
        check(after.history.filter(e=>e.action==='choose-reward').length===1,'skip duplicate choice');
        const receipt=await p.locator('[data-game-receipt=journey]').innerText();check(receipt.includes('已跳过奖励'),'skip receipt missing');
        results.push({mode,receipt,singleChoice:true,errors});continue;
      }
      await p.getByRole('button',{name:/^临时壁垒，费用 /}).click();const scroll=await p.locator('.reward-choices').evaluate(e=>e.scrollLeft);
      await p.getByRole('button',{name:'取消选择',exact:true}).click();
      const cancel=await p.evaluate(()=>({label:document.activeElement?.getAttribute('aria-label'),scroll:document.querySelector('.reward-choices').scrollLeft}));
      check(cancel.label?.startsWith('临时壁垒，')&&Math.abs(cancel.scroll-scroll)<1,'cancel lost focus or scroll');
      check(await raw()===rewardBefore,'preview/cancel wrote save');
      await p.getByRole('button',{name:/^连刃，费用 /}).click();await p.getByRole('button',{name:'确认加入 连刃',exact:true}).click();
      let bad=true,quoteRequests=0;
      await p.route('**/stages/**/exit-after-entry.json',async route=>{quoteRequests++;const response=await route.fetch(),data=await response.json();if(bad)data.date='19000101';await route.fulfill({response,json:data});});
      await p.getByLabel('参与金额（金币）').fill('20');await p.getByRole('button',{name:'确认参与 20 金币',exact:true}).click();await p.getByRole('button',{name:'继续前往岔路',exact:true}).click();await p.getByRole('button',{name:'选择这条路',exact:true}).first().click();
      let turns=0;while(await p.getByRole('button',{name:'结束回合',exact:true}).count()){await p.getByRole('button',{name:'结束回合',exact:true}).click();check(++turns<=16,'shares defeat stalled');}
      const retry=p.getByRole('button',{name:'重新加载',exact:true});await retry.waitFor();
      const beforeRetry=await raw(),pending=JSON.parse(beforeRetry).run,body=await p.getByRole('main').innerText();
      check(body.includes('战斗失败')&&body.includes('自动回收')&&body.includes('报价必须晚于')&&!body.includes('。。'),'ending/error feedback missing');
      check(pending.status==='defeated'&&pending.phase==='market'&&pending.market.order?.automatic,'ending state wrong');
      await p.screenshot({path:'output/playwright/defeat-quote-error-after.png',fullPage:true});
      await retry.click();await retry.waitFor();check(quoteRequests===2&&await raw()===beforeRetry,'failed retry changed save or reused stale cache');
      bad=false;await retry.click();await p.getByRole('heading',{name:'战斗失败，旅程暂告一段落',exact:true}).waitFor();
      const after=(await read()).run,redemptions=after.wallet.ledger.filter(e=>e.kind==='redemption');
      check(quoteRequests===3&&after.phase==='ended'&&after.wallet.shareUnits==='0'&&after.market.order===null,'recovery did not finish');
      check(redemptions.length===1&&after.history.filter(e=>e.action==='auto-liquidation').length===1,'duplicate automatic settlement');
      check(after.wallet.cashCents===pending.wallet.cashCents+after.wallet.proceedsCents,'cash not credited exactly once');
      const endedRaw=await raw();await p.reload({waitUntil:'networkidle'});await p.getByRole('button',{name:'查看上次旅程',exact:true}).click();check(await raw()===endedRaw,'reload repeated settlement');
      check(errors.length===0,'unexpected page exception');
      results.push({mode,cancelFocus:cancel.label,cancelScrollPreserved:true,body,quoteRequests,originalOrder:pending.market.order.id,autoOrders:1,redemptions:1,cashBefore:pending.wallet.cashCents,cashAfter:after.wallet.cashCents,reloadUnchanged:true,errors});
    }finally{await context.close();}
  }
  return{isolatedFreshGames:true,results};
}
