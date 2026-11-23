async page => {
  const snapshotStorage = () => page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])));
  const names = await page.locator('.hand .game-card').evaluateAll(cards => cards.map(card => card.getAttribute('aria-label')));
  const chosen = names.find(name => name?.startsWith('候机，')) ?? names.find(name => name?.startsWith('敲击，')) ?? names[0];
  await page.getByRole('button', { name: chosen, exact: true }).first().click();
  const target = page.locator('.battle-dock select');
  if (await target.count()) {
    const options = await target.locator('option').evaluateAll(items => items.map(item => item.value));
    if (options.length > 1) await target.selectOption(options[options.length - 1]);
  }
  await page.locator('.hand').evaluate(el => { el.scrollLeft = el.scrollWidth; });
  const selectedBefore = await page.locator('.hand .game-card.selected').getAttribute('aria-label');
  const targetBefore = await target.count() ? await target.inputValue() : null;
  const scrollBefore = await page.locator('.hand').evaluate(el => el.scrollLeft);
  const before = await snapshotStorage();
  const requests = [];
  const onRequest = request => { if (request.url().includes('/data/')) requests.push(request.url()); };
  page.on('request', onRequest);
  await page.getByRole('button', { name: /^查看.+的行动节奏$/ }).click();
  const dialog = page.getByRole('dialog', { name: '对手行动节奏' });
  const actions = await dialog.locator('.enemy-plan-list li').allTextContents();
  const text = await dialog.innerText();
  await page.screenshot({ path: 'output/playwright/enemy-plan-mobile.png' });
  await page.keyboard.press('Tab');
  const keyboardFocus = await page.evaluate(() => document.activeElement?.textContent);
  await page.keyboard.press('Escape');
  const after = await snapshotStorage();
  page.off('request', onRequest);
  const selectedAfter = await page.locator('.hand .game-card.selected').getAttribute('aria-label');
  const targetAfter = await target.count() ? await target.inputValue() : null;
  const scrollAfter = await page.locator('.hand').evaluate(el => el.scrollLeft);
  const focusAfter = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  if (before !== after || selectedBefore !== selectedAfter || targetBefore !== targetAfter || Math.abs(scrollBefore - scrollAfter) > 1 || requests.length) throw new Error('Viewing enemy plan changed state, selection or fetched data');
  const image = page.locator('.avatar.player img');
  await image.evaluate(img => img.decode());
  const imageLayout = await image.evaluate(img => ({ image: img.getBoundingClientRect().toJSON(), parent: img.closest('.avatar').getBoundingClientRect().toJSON(), fit: getComputedStyle(img).objectFit }));
  if (imageLayout.image.bottom > imageLayout.parent.bottom + 1 || imageLayout.image.top < imageLayout.parent.top - 1 || imageLayout.fit !== 'contain') throw new Error('Traveler image overflows its frame');
  await page.screenshot({ path: 'output/playwright/enemy-plan-battle-mobile.png' });
  return { actions, text, chosen, targetBefore, targetAfter, scrollBefore, scrollAfter, sameStorage: before === after, dataRequests: requests, keyboardFocus, focusAfter, imageLayout, boardHeight: await page.locator('.battle-board').evaluate(el => el.getBoundingClientRect().height) };
}
