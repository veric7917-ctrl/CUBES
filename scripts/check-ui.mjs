// Optional browser check: npm install --no-save playwright
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { CUBE_SETS } from '../public/levels.js';
import { createApp } from '../server.js';
const localServer = process.env.TEST_URL ? null : createApp();
if (localServer) await new Promise(resolve => localServer.listen(0, '127.0.0.1', resolve));
const base = process.env.TEST_URL || `http://127.0.0.1:${localServer.address().port}`;
async function expectVisibleFaces(page, front, top, selector = '#my-cubes .cube-wrap:nth-child(2) .cube') {
  await page.waitForFunction(({ selector, front, top }) => {
    const cube = document.querySelector(selector);
    const matrix = new DOMMatrix(getComputedStyle(cube).transform);
    const quarterTurns = -Math.atan2(matrix.m23, matrix.m22) / (Math.PI / 2);
    if (Math.abs(quarterTurns - Math.round(quarterTurns)) > .001) return false;
    const slot = ((Math.round(quarterTurns) % 4) + 4) % 4;
    return cube.querySelector(`.face-${slot}`).textContent === front && cube.querySelector(`.face-${(slot + 1) % 4}`).textContent === top;
  }, { selector, front, top });
}
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-features=CalculateNativeWinOcclusion', '--disable-frame-rate-limit'] });
try {
for (const level of [1, 2, 3]) {
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(12000);
const teacher = await context.newPage(), anna = await context.newPage(), max = await context.newPage();
for (const page of [teacher, anna, max]) page.on('pageerror', e => errors.push(e.message));
try {
  await mkdir('test-results', { recursive: true });
  await teacher.goto(base, { waitUntil: 'domcontentloaded' });
  await teacher.getByRole('button', { name: 'Question word: WHAT. Rotate cube' }).click();
  await teacher.getByRole('button', { name: 'Question word: WHEN. Rotate cube' }).waitFor();
  await teacher.getByRole('radio', { name: level === 4 ? 'LEVEL 4 — WHO QUESTIONS' : level === 3 ? 'LEVEL 3 — PRESENT FORMS' : `LEVEL ${level}`, exact: true }).check();
  const badge = `LEVEL 0${level} · ${level === 4 ? 'WHO QUESTIONS' : level === 3 ? 'PRESENT FORMS' : 'ENGLISH'}`;
  assert.equal(await teacher.locator('.level').textContent(), badge);
  await teacher.screenshot({ path: `test-results/level-${level}-home.png`, fullPage: true });
  await teacher.getByRole('button', { name: 'Create a room' }).click();
  await teacher.locator('#room-code').waitFor();
  const code = await teacher.locator('#room-code').textContent();
  for (const [page, name] of [[anna, 'Anna Elizabeth'], [max, 'Max Alexander']]) {
    await page.goto(`${base}/?room=${code}`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Your name').fill(name);
    await page.getByRole('button', { name: 'Join room' }).click();
    await page.locator('#student-name').waitFor();
    assert.equal(await page.locator('#student-name').textContent(), name);
    assert.equal(await page.locator('.level').textContent(), badge);
    assert.equal(await page.getByRole('radio').count(), 0);
    const expectedFaces = CUBE_SETS[level];
    for (let i = 0; i < 4; i++) {
      const faces = expectedFaces[i];
      assert.deepEqual(await page.locator('#my-cubes .cube').nth(i).locator('.face:not(.cap-left):not(.cap-right)').allTextContents(), faces.length > 4 ? [faces[0], faces[1], faces[2], faces.at(-1)] : Array.from({ length: 4 }, (_, i) => faces[i % faces.length]));
    }
    // Verify both full question-word cycles, including WHY and WHAT TIME, on each student and teacher.
    const questions = expectedFaces[0];
    for (let i = 1; i <= questions.length * 2; i++) {
      await page.locator('#my-cubes button').nth(0).click();
      assert.equal(await page.locator('#my-cubes button').nth(0).getAttribute('aria-label'), 'Question word: ' + questions[i % questions.length] + '. Rotate cube');
      await expectVisibleFaces(page, questions[i % questions.length], questions[(i + 1) % questions.length], '#my-cubes .cube-wrap:nth-child(1) .cube');
      const cardIndex = page === anna ? 1 : 2;
      await expectVisibleFaces(teacher, questions[i % questions.length], questions[(i + 1) % questions.length], '.student-card:nth-child(' + cardIndex + ') .cube-wrap:nth-child(1) .cube');
      if (i === 5 && level !== 1 && page === anna) await page.screenshot({ path: 'test-results/level-' + level + '-what-time.png', fullPage: true });
    }
    // Check a complete auxiliary rotation and wrap back to DO on each student.
    const count = expectedFaces[1].length;
    for (let i = 1; i <= count * 2; i++) {
      await page.locator('#my-cubes button').nth(1).click();
      assert.equal(await page.locator('#my-cubes button').nth(1).getAttribute('aria-label'), `Auxiliary: ${expectedFaces[1][i % count]}. Rotate cube`);
      await expectVisibleFaces(page, expectedFaces[1][i % count], expectedFaces[1][(i + 1) % count]);
    }
    if (level >= 2) {
      const verbs = expectedFaces[3];
      for (let i = 1; i <= verbs.length * 2; i++) {
        await page.locator('#my-cubes button').nth(3).click();
        assert.equal(await page.locator('#my-cubes button').nth(3).getAttribute('aria-label'), 'Verb: ' + verbs[i % verbs.length] + '. Rotate cube');
        await expectVisibleFaces(page, verbs[i % verbs.length], verbs[(i + 1) % verbs.length], '#my-cubes .cube-wrap:nth-child(4) .cube');
        const cardIndex = page === anna ? 1 : 2;
        await expectVisibleFaces(teacher, verbs[i % verbs.length], verbs[(i + 1) % verbs.length], '.student-card:nth-child(' + cardIndex + ') .cube-wrap:nth-child(4) .cube');
      }
    }
    if (level === 2) {
      await page.locator('#my-cubes button').nth(1).evaluate(button => { for (let i = 0; i < 10; i++) button.click(); });
      // Wait for two complete physical revolutions plus two quarter-turns.
      await page.waitForFunction(() => document.querySelector('#my-cubes .cube-wrap:nth-child(2) .cube').style.transform === 'rotateX(-1800deg)');
      await expectVisibleFaces(page, 'DO', 'DOES');
    }
  }
  await anna.locator('#my-cubes button').nth(0).click();
  await anna.locator('#my-cubes button').nth(1).click();
  for (let i = 0; i < 3; i++) await anna.locator('.cube-control').nth(2).click();
  for (let i = 0; i < 2; i++) await anna.locator('.cube-control').nth(3).click();
  await teacher.locator('.student-card').filter({ hasText: 'Anna' }).locator(`[aria-label="Verb: ${CUBE_SETS[level][3][2]}"]`).waitFor();
  const annaCard = teacher.locator('.student-card').filter({ hasText: 'Anna' });
  assert.equal(await teacher.locator('.level').textContent(), badge);
  if (level === 2) {
    await anna.locator('#my-cubes button').nth(1).click();
    await annaCard.locator('[aria-label="Auxiliary: DID"]').waitFor();
    await max.locator('#my-cubes button').nth(1).click();
    await max.locator('#my-cubes button').nth(1).click();
    await max.locator('#my-cubes button').nth(1).click();
    await max.locator('#my-cubes button').nth(1).click();
    await teacher.locator('.student-card').filter({ hasText: 'Max' }).locator('[aria-label="Auxiliary: WILL"]').waitFor();
    await expectVisibleFaces(max, 'WILL', 'DO');
    await max.reload({ waitUntil: 'domcontentloaded' });
    await max.locator('#my-cubes').waitFor();
    await expectVisibleFaces(max, 'WILL', 'DO');
  }
  assert.equal(await annaCard.locator('.cube-control').nth(2).getAttribute('aria-label'), 'Subject: SHE');
  assert.equal(await max.locator('.cube-control').nth(0).getAttribute('aria-label'), 'Question word: ' + CUBE_SETS[level][0][0] + '. Rotate cube');
  for (let i = 0; i < 12; i++) await anna.locator('.cube-control').nth(0).click();
  assert.equal(await anna.locator('.cube-control').nth(0).getAttribute('aria-label'), 'Question word: ' + CUBE_SETS[level][0][1 % CUBE_SETS[level][0].length] + '. Rotate cube');
  await anna.reload({ waitUntil: 'domcontentloaded' });
  await anna.getByRole('button', { name: 'Subject: SHE. Rotate cube' }).waitFor();
  assert.equal(await anna.locator('.level').textContent(), badge);
  await teacher.screenshot({ path: 'test-results/teacher.png', fullPage: true });
  await anna.screenshot({ path: 'test-results/student.png', fullPage: true });
  await anna.setViewportSize({ width: 768, height: 1024 });
  await anna.screenshot({ path: 'test-results/tablet.png', fullPage: true });
  assert.equal(await anna.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await anna.locator('.cube-label').count(), 0);
  assert.equal(await teacher.locator('.cube-label').count(), 0);
  assert.equal(await anna.getByRole('button', { name: 'NEW ROUND' }).count(), 0);
  await anna.locator('#bell').click();
  assert.equal(await anna.locator('#my-cubes button:disabled').count(), 4);
  await teacher.locator('.student-card').filter({ hasText: 'Anna Elizabeth' }).getByText('🔔 Finished · Locked').waitFor();
  assert.equal(await anna.locator('#partner-question').isVisible(), false);
  assert.equal(await max.locator('#partner-question').isVisible(), false);
  await max.locator('#my-cubes button').first().click();
  await anna.reload({ waitUntil: 'domcontentloaded' });
  await anna.locator('#my-cubes button:disabled').first().waitFor();
  await max.locator('#bell').click();
  await anna.locator('#partner-question').waitFor();
  await max.locator('#partner-question').waitFor();
  assert.equal(await max.locator('#my-cubes button:disabled').count(), 4);
  assert.equal(await anna.locator('#partner-question h2').textContent(), 'Max Alexander');
  if (level === 2) {
    assert.equal(await anna.locator('#partner-question .cube-control').nth(1).getAttribute('aria-label'), 'Auxiliary: WILL');
    await expectVisibleFaces(anna, 'WILL', 'DO', '#partner-question .cube-wrap:nth-child(2) .cube');
    assert.equal(await max.locator('#partner-question .cube-control').nth(1).getAttribute('aria-label'), 'Auxiliary: DID');
  }
  if (level === 4) {
    await expectVisibleFaces(anna, '', 'DO', '#partner-question .cube-wrap:nth-child(2) .cube');
    await expectVisibleFaces(max, 'WHO', 'WHO', '#partner-question .cube-wrap:nth-child(1) .cube');
  }
  await anna.setViewportSize({ width: 1440, height: 1000 });
  await anna.screenshot({ path: `test-results/level-${level}-compare.png`, fullPage: true });
  await teacher.screenshot({ path: 'test-results/teacher-finished.png', fullPage: true });
  await teacher.getByRole('button', { name: 'NEW ROUND' }).click();
  await anna.locator('#my-cubes button:enabled').first().waitFor();
  await max.locator('#my-cubes button:enabled').first().waitFor();
  assert.equal(await anna.locator('#partner-question').isVisible(), false);
  assert.equal(await max.locator('#partner-question').isVisible(), false);
  assert.equal(await teacher.locator('#room-code').textContent(), code);
  for (const page of [teacher, anna, max]) assert.equal(await page.locator('.level').textContent(), badge);
  assert.equal(await anna.locator('#bell').isEnabled(), true);
  assert.equal(await max.locator('#bell').isEnabled(), true);
  await anna.locator('#my-cubes button').first().click();
  await anna.locator('#bell').click();
  await max.locator('#bell').click();
  await anna.locator('#partner-question').waitFor();
  await max.locator('#partner-question').waitFor();
  assert.deepEqual(errors, []);
  console.log(`Level ${level} browser check passed: exact cube sets, teacher-selected level, live cubes, full names, bell locks, private waiting, reveal, teacher-only new round, second round, reload and tablet.`);
} catch (error) {
  console.log(errors);
  console.log(await anna.locator('body').innerText());
  throw error;
} finally { await context.close(); }
}
} finally { await browser.close(); localServer?.closeAllConnections(); localServer?.close(); }
