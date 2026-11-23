async page => {
  const base = 'http://127.0.0.1:4186/';
  const S = 'nextcard:adventure:v0.4', V = S + ':seen-cases', E = S + ':funding-exposure';
  const results = [];
  const check = (value, message) => { if (!value) throw new Error(message); };
  const snapshot = p => p.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), [S,V,E]);
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  async function fresh(label, fn) {
    const context = await page.context().browser().newContext({viewport:{width:390,height:844},acceptDownloads:true});
    const p = await context.newPage(); const errors=[]; p.on('pageerror',e=>errors.push(e.message));
    p.setDefaultTimeout(7000);
    try {
      await p.goto(base,{waitUntil:'networkidle'});
      await p.getByRole('button',{name:'开始旅程 · 生成本局观察',exact:true}).click();
      await p.getByRole('button',{name:'结束回合',exact:true}).waitFor();
      const raw = await snapshot(p), save = JSON.parse(raw[S]);
      const detail = await fn(p,save,raw);
      check(errors.length===0, label+': page errors '+errors.join(';'));
      results.push({label,passed:true,...detail});
    } finally { await context.close(); }
  }
  async function inject(p, entries) {
    await p.evaluate(entries => { for(const [key,value] of Object.entries(entries)) { if(value===null) localStorage.removeItem(key); else localStorage.setItem(key,value); } }, entries);
    await p.reload({waitUntil:'networkidle'});
  }
  async function backup(p) {
    const event=p.waitForEvent('download');
    await p.getByRole('button',{name:'下载本地备份',exact:true}).click();
    const download=await event; const stream=await download.createReadStream(); let raw='';
    for await (const chunk of stream) raw += chunk.toString();
    return {name:download.suggestedFilename(),data:JSON.parse(raw)};
  }
  async function recovery(p) { await p.getByRole('heading',{name:'本地记录需要处理',exact:true}).waitFor(); }
  async function replacement(p) {
    await p.getByRole('button',{name:'清除后只玩游戏',exact:true}).click();
    await p.getByRole('button',{name:'确认清除并开始',exact:true}).click();
  }
  async function fault(p,mode) {
    await p.addInitScript(({S,E,mode}) => {
      window.__storageFault=mode;
      const get=Storage.prototype.getItem,set=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
      Storage.prototype.getItem=function(k) { if(window.__storageFault==='unreadable') throw new DOMException('Test denied','SecurityError'); return get.call(this,k); };
      Storage.prototype.setItem=function(k,v) { if(k===S && (window.__storageFault==='deny-save' || (window.__storageFault==='rollback-fails' && v==='{broken'))) throw new DOMException('Test denied','QuotaExceededError'); return set.call(this,k,v); };
      Storage.prototype.removeItem=function(k) { if(k===E && ['deny-archive','rollback-fails'].includes(window.__storageFault)) throw new DOMException('Test denied','SecurityError'); return remove.call(this,k); };
    }, {S,E,mode});
  }
  await fresh('corrupt main, backup, cancel and confirmed replacement', async(p,s) => {
    delete s.run.history; delete s.tutorialStep;
    const original={ [S]:JSON.stringify(s),[V]:'["lantern-a"]',[E]:'{"version":88}' };
    await inject(p,{...original,'nextcard:v1':'legacy-kept'}); await recovery(p);
    check(equal(await snapshot(p),original),'corrupt main changed');
    await p.getByRole('button',{name:'重试读取本地记录',exact:true}).click();
    check(equal(await snapshot(p),original),'retry changed original');
    const dl=await backup(p); check(equal(dl.data,original),'backup content differs');
    await p.getByRole('button',{name:'设置',exact:true}).click();
    check((await p.getByRole('dialog').innerText()).includes('本地记录尚未恢复'),'recovery settings status');
    check(await p.getByRole('button',{name:'撤销观察并删除观察记录',exact:true}).count()===0,'unsafe revoke');
    await p.keyboard.press('Escape');
    await p.getByRole('button',{name:'清除后只玩游戏',exact:true}).click();
    await p.getByRole('button',{name:'保留现有记录',exact:true}).click();
    check(equal(await snapshot(p),original),'cancel changed data');
    check(await p.evaluate(()=>document.activeElement?.textContent)==='清除后只玩游戏','cancel focus');
    await p.setViewportSize({width:360,height:800});
    check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'recovery overflow');
    await p.screenshot({path:'output/playwright/save-recovery-360.png',fullPage:true});
    await replacement(p); await p.getByRole('button',{name:'结束回合',exact:true}).waitFor();
    const current=await snapshot(p), next=JSON.parse(current[S]);
    check(next.run.phase==='battle' && !next.profile.enabled && !next.run.observationEnabled,'replacement mode');
    check(current[V]===null && current[E]===null,'auxiliary keys retained');
    check(await p.evaluate(()=>localStorage.getItem('nextcard:v1'))==='legacy-kept','legacy removed');
    return {backupName:dl.name,mobileOverflow:false,newGameOnlyAfterConfirmation:true};
  });
  for(const type of ['unknown-version','invalid-profile','invalid-seen','invalid-archive']) {
    await fresh(type, async(p,s) => {
      const fixture={[S]:JSON.stringify(s),[V]:'["lantern-a"]',[E]:null};
      if(type==='unknown-version'){s.run.version='0.9.0';fixture[S]=JSON.stringify(s);}
      if(type==='invalid-profile'){s.profile.funding_exposure={bad:true};fixture[S]=JSON.stringify(s);}
      if(type==='invalid-seen') fixture[V]='{"bad":true}';
      if(type==='invalid-archive') fixture[E]='{broken';
      await inject(p,fixture); await recovery(p);
      check(equal(await snapshot(p),fixture),type+' changed original');
      check(equal((await backup(p)).data,fixture),type+' backup differs');
      return {originalPreserved:true};
    });
  }
  for(const mode of ['deny-save','deny-archive','rollback-fails']) {
    await fresh(mode, async(p) => {
      const original={[S]:'{broken',[V]:'["lantern-a"]',[E]:'{bad'};
      await fault(p,mode); await inject(p,original); await recovery(p); await replacement(p); await recovery(p);
      const body=await p.locator('body').innerText();
      if(mode==='rollback-fails') {
        check(body.includes('未能完全恢复'),'rollback failure not disclosed');
        await p.getByRole('button',{name:'重试读取本地记录',exact:true}).click();
        check((await p.locator('body').innerText()).includes('仍可下载此前读取的备份'),'retry lost backup');
      } else check(equal(await snapshot(p),original),mode+' failed to preserve original');
      check(equal((await backup(p)).data,original),mode+' original backup lost');
      return {failureReported:true,backupPreserved:true};
    });
  }
  await fresh('unreadable storage can retry without replacement', async(p,s,original) => {
    await fault(p,'unreadable'); await p.reload({waitUntil:'networkidle'}); await recovery(p);
    check(await p.getByRole('button',{name:'下载本地备份',exact:true}).isDisabled(),'unreadable export enabled');
    check(await p.getByRole('button',{name:'清除后只玩游戏',exact:true}).isDisabled(),'unreadable replacement enabled');
    await p.evaluate(()=>{window.__storageFault='';});
    await p.getByRole('button',{name:'重试读取本地记录',exact:true}).click();
    await p.getByRole('button',{name:'继续上次旅程',exact:true}).click();
    check(equal(await snapshot(p),original),'unreadable retry changed original');
    return {retryResumed:true};
  });
  for(const mode of ['expired-main-bad-archive','bad-main-expired-archive','expiry-main-write-denied']) {
    await fresh(mode, async(p,s) => {
      const age=Date.now()-31*24*60*60*1000;
      s.observationStartedAt=age;
      const original={[S]:mode==='bad-main-expired-archive'?'{broken':JSON.stringify(s),[V]:null,[E]:mode==='expired-main-bad-archive'?'{bad':JSON.stringify({version:1,createdAt:age,entries:[]})};
      if(mode==='expiry-main-write-denied') await fault(p,'deny-save');
      await inject(p,original); await recovery(p); const after=await snapshot(p);
      if(mode==='expired-main-bad-archive') { const cleaned=JSON.parse(after[S]); check(!cleaned.profile.enabled && !cleaned.run.observationEnabled && cleaned.run.id===s.run.id,'expired main not safely cleaned'); check(after[E]==='{bad','bad archive removed'); }
      else { check(after[S]===original[S],'main unexpectedly changed');check(after[E]===null,'expired archive not removed'); }
      if(mode==='expiry-main-write-denied') check((await p.locator('body').innerText()).includes('部分过期观察仍未清理'),'partial expiry not disclosed');
      check(equal((await backup(p)).data,after),'backup resurrected expired data');
      return {independentExpiry:true,backupMatchesRemainingRecords:true};
    });
  }
  await fresh('legacy clear preserves adventure keys', async(p) => {
    await p.evaluate(k=>localStorage.setItem(k,'["lantern-a"]'),V); const before=await snapshot(p);
    await p.goto(base+'?legacy=1',{waitUntil:'networkidle'});
    if(await p.getByRole('button',{name:'我知道了',exact:true}).count()) await p.getByRole('button',{name:'我知道了',exact:true}).click();
    await p.getByRole('button',{name:'隐私说明',exact:true}).click();
    p.once('dialog',d=>d.accept()); await p.getByRole('button',{name:'清除本局记录',exact:true}).click();
    check(equal(await snapshot(p),before),'legacy cleared adventure'); return {adventurePreserved:true};
  });
  return results;
}
