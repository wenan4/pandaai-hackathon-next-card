async page => {
  await page.setViewportSize({ width: 390, height: 844 });
  const results = [];
  const testUrl = 'http://127.0.0.1:4186/?startup-check=1#resume';
  const shell = () => page.locator('#startup-shell');
  const snapshotStorage = () => page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map(key => {
    const raw = localStorage.getItem(key);
    if (key === 'nextcard:adventure:v0.4' && raw) {
      const save = JSON.parse(raw);
      delete save.savedAt;
      return [key, JSON.stringify(save)];
    }
    return [key, raw];
  })));
  await page.goto(testUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '回到冒险首页', exact: true }).waitFor();
  const baseline = await snapshotStorage();
  if (await shell().count()) throw new Error('Normal startup shell still present');
  results.push({ name: 'normal', passed: true });

  for (const [name, pattern] of [
    ['entry', '**/assets/index-*.js'],
    ['ui', '**/assets/ui-*.js'],
    ['css', '**/assets/ui-*.css'],
  ]) {
    try {
      await page.route(pattern, route => route.abort());
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('#startup-shell[data-state="error"]').waitFor();
      const errorState = await shell().innerText();
      if (name === 'entry') {
        await page.keyboard.press('Tab');
        if (await page.evaluate(() => document.activeElement?.id) !== 'startup-retry') throw new Error('Retry is not keyboard reachable');
      }
      const unchanged = baseline === await snapshotStorage();
      if (!unchanged) throw new Error(`${name} failure changed local records`);
      await page.screenshot({ path: `output/playwright/startup-${name}-failure.png` });
      await page.unroute(pattern);
      await page.locator('#startup-retry').click();
      await page.getByRole('button', { name: '回到冒险首页', exact: true }).waitFor();
      await page.waitForLoadState('networkidle');
      if (page.url() !== testUrl) throw new Error(`${name} retry changed URL`);
      if (await shell().count()) throw new Error(`${name} retry left shell`);
      if (baseline !== await snapshotStorage()) throw new Error(`${name} retry changed local records`);
      results.push({ name, passed: true, errorState, sameUrl: true, sameProgressExceptSavedAt: true });
    } finally {
      await page.unroute(pattern);
    }
  }

  const pattern = '**/assets/ui-*.js';
  let release;
  const released = new Promise(resolve => { release = resolve; });
  try {
    await page.route(pattern, async route => { await released; await route.continue(); });
    await page.reload({ waitUntil: 'commit' });
    await page.locator('#startup-shell[data-state="slow"]').waitFor({ timeout: 15000 });
    const slowText = await shell().innerText();
    release();
    await page.getByRole('button', { name: '回到冒险首页', exact: true }).waitFor();
    await page.waitForLoadState('networkidle');
    if (await shell().count()) throw new Error('Late success left shell');
    if (baseline !== await snapshotStorage()) throw new Error('Slow success changed local records');
    results.push({ name: 'slow-then-success', passed: true, slowText, sameProgressExceptSavedAt: true });
  } finally {
    release();
    await page.unroute(pattern);
  }

  try {
    await page.route(pattern, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'throw new Error("injected-startup-initialization-failure");' }));
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#startup-shell[data-state="error"]').waitFor();
    const errorText = await shell().innerText();
    if (errorText.includes('injected-startup')) throw new Error('Raw exception leaked into UI');
    if (baseline !== await snapshotStorage()) throw new Error('Initialization failure changed records');
    results.push({ name: 'initialization-failure', passed: true, errorText });
  } finally {
    await page.unroute(pattern);
    await page.reload({ waitUntil: 'networkidle' });
  }

  const noJsContext = await page.context().browser().newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const noJsPage = await noJsContext.newPage();
    await noJsPage.goto(testUrl, { waitUntil: 'networkidle' });
    const text = await noJsPage.locator('body').innerText();
    if (!text.includes('JavaScript')) throw new Error('No JavaScript instructions missing');
    await noJsPage.screenshot({ path: 'output/playwright/startup-no-javascript.png' });
    results.push({ name: 'javascript-disabled', passed: true, text });
  } finally {
    await noJsContext.close();
  }
  return results;
}
