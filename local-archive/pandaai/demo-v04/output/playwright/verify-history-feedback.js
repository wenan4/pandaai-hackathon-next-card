async page => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '继续上次旅程', exact: true }).click();
  await page.getByRole('button', { name: '试试历史比较', exact: true }).click();
  await page.getByRole('button', { name: '锁定并查看同期资料', exact: true }).click();
  await page.getByRole('button', { name: /再查看另一段历史/ }).click();
  await page.getByLabel('这些结果能说明什么？').waitFor();
  await page.getByLabel('本案例结果相对同期基准').selectOption('underperform');
  await page.getByLabel('另一段历史的结果相对第一段').selectOption('underperform');
  await page.getByLabel('这些结果能说明什么？').selectOption('only_samples');
  await page.getByLabel('这次主要依据什么？').selectOption('根据同日期的数字比较');
  await page.getByRole('button', { name: '提交这次研究', exact: true }).click();
  const section = page.locator('#research-d2-result');
  await page.waitForFunction(() => {
    const heading = document.querySelector('#research-d2-result h2');
    return document.activeElement?.id === 'research-d2-result' && heading && heading.getBoundingClientRect().top >= 0 && heading.getBoundingClientRect().top < innerHeight - 100;
  });
  const result = {
    feedback: await section.locator('.notice').first().innerText(),
    heading: await section.getByRole('heading', { name: '研究后的观察', exact: true }).boundingBox(),
    firstFeedback: await section.locator('.notice').first().boundingBox(),
    focus: await page.evaluate(() => document.activeElement?.id),
    profile: await page.evaluate(() => {
      const profile = JSON.parse(localStorage.getItem('nextcard:adventure:v0.4')).profile;
      return { enabled: profile.enabled, knowledge: profile.knowledge_evidence.length, research: profile.research_process.length, funding: profile.funding_attempts.length };
    }),
    laterDataButtonCount: await page.getByRole('button', { name: /再查看另一段历史/ }).count(),
  };
  if (result.focus !== 'research-d2-result' || !result.heading || result.heading.y < 0 || result.heading.y > 500 || !result.firstFeedback || result.firstFeedback.y < 0 || result.firstFeedback.y > 500) throw new Error('Submitted feedback is not brought into view');
  if (!result.profile.enabled && (result.profile.knowledge || result.profile.research || result.profile.funding)) throw new Error('Play-only practice recorded observations');
  await page.screenshot({ path: `output/playwright/history-feedback-${result.profile.enabled ? 'observed' : 'practice'}-visible.png` });
  return result;
}
