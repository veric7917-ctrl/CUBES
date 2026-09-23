import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { CUBE_SETS } from '../public/levels.js';
import { mkdir } from 'node:fs/promises';

const server = createApp();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-features=CalculateNativeWinOcclusion', '--disable-frame-rate-limit'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(12000);
const teacher = await context.newPage(), anna = await context.newPage(), max = await context.newPage();
const errors = [];
for (const page of [teacher, anna, max]) page.on('pageerror', error => errors.push(error.message));
const sets = CUBE_SETS[4];
const labels = ['Question word', 'Auxiliary', 'Subject-question verb', 'Noun', 'Base verb'];
const positions = new Map([[anna, [0, 0, 0, 0, 0]], [max, [0, 0, 0, 0, 0]]]);
async function visible(page, selector, index, position) {
  const faces = sets[index];
  await page.waitForFunction(({selector, index, front, top}) => {
    const cube = document.querySelectorAll(selector + ' .cube')[index];
    if (!cube) return false;
    const matrix = new DOMMatrix(getComputedStyle(cube).transform);
    const turns = -Math.atan2(matrix.m23, matrix.m22) / (Math.PI / 2);
    if (Math.abs(turns - Math.round(turns)) > .001) return false;
    const slot = ((Math.round(turns) % 4) + 4) % 4;
    return cube.querySelector('.face-' + slot).textContent === front && cube.querySelector('.face-' + ((slot + 1) % 4)).textContent === top;
  }, {selector, index, front: faces[position], top: faces[(position + 1) % faces.length]});
}
async function row(page, selector, expected) {
  assert.equal(await page.locator(selector + ' .cube').count(), 5);
  for (let i = 0; i < 5; i++) await visible(page, selector, i, expected[i]);
}
async function turn(page, index) {
  await page.locator('#my-cubes button').nth(index).click();
  const state = positions.get(page);
  state[index] = (state[index] + 1) % sets[index].length;
  assert.equal(await page.locator('#my-cubes button').nth(index).getAttribute('aria-label'), `${labels[index]}: ${sets[index][state[index]]}. Rotate cube`);
  await visible(page, '#my-cubes', index, state[index]);
  await visible(teacher, `.student-card:nth-child(${page === anna ? 1 : 2})`, index, state[index]);
}
async function build(page, target) {
  for (let i = 0; i < 5; i++) while (positions.get(page)[i] !== target[i]) await turn(page, i);
  await row(page, '#my-cubes', target);
  await row(teacher, `.student-card:nth-child(${page === anna ? 1 : 2})`, target);
  assert.equal(await page.locator('#room-error').textContent(), '');
}
async function layout(page, name) {
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({width, height: 1000});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} overflow at ${width}`);
    const rowsFit = await page.locator('.five-cubes').evaluateAll(rows => rows.filter(r => r.getBoundingClientRect().width > 0).every(r => {
      const cubes = [...r.querySelectorAll('.cube-control')].map(c => {
        const faces = [...c.querySelectorAll('.face')].map(f => f.getBoundingClientRect());
        return {left: Math.min(...faces.map(f => f.left)), right: Math.max(...faces.map(f => f.right))};
      });
      return cubes.every((c, i) => c.left >= 0 && c.right <= innerWidth && (!i || cubes[i - 1].right <= c.left));
    }));
    assert.equal(rowsFit, true, `${name} cube overlap at ${width}`);
    await page.screenshot({path: `test-results/level-4-${name}-${width}.png`, fullPage: true});
  }
  await page.setViewportSize({width:1440, height:1000});
}
try {
  await mkdir('test-results', {recursive:true});
  await teacher.goto(base);
  await teacher.getByRole('radio', {name:'LEVEL 4 — WHO QUESTIONS', exact:true}).check();
  await row(teacher, '#preview', [0,0,0,0,0]);
  await layout(teacher, 'home');
  await teacher.getByRole('button', {name:'Create a room'}).click();
  await teacher.locator('#room-code').waitFor();
  const code = await teacher.locator('#room-code').textContent();
  for (const [page, name] of [[anna,'Anna Elizabeth'], [max,'Max Alexander']]) {
    await page.goto(`${base}/?room=${code}`);
    await page.getByLabel('Your name').fill(name);
    await page.getByRole('button', {name:'Join room'}).click();
    await page.locator('#student-name').waitFor();
    assert.equal(await page.locator('#student-name').textContent(), name);
    assert.equal(await page.locator('.level').textContent(), 'LEVEL 04 · WHO QUESTIONS');
    assert.equal(await page.locator('footer span:last-child').textContent(), 'Five cubes. Endless possibilities.');
    assert.equal(await page.getByRole('radio').count(), 0);
    assert.equal(await page.getByRole('button', {name:'NEW ROUND'}).count(), 0);
    await row(page, '#my-cubes', [0,0,0,0,0]);
    for (let cube = 0; cube < 5; cube++) {
      for (let i = 0; i < sets[cube].length * 2; i++) await turn(page, cube);
    }
  }
  // Each student manually builds both patterns; nothing selects or blanks another cube.
  await build(anna, [0,0,1,0,0]); // WHO [blank] HELPS TOM [blank]
  await build(max, [0,0,12,2,0]); // WHO [blank] SAW THE BOYS [blank]
  await layout(anna, 'subject');
  await build(anna, [0,2,0,1,4]); // WHO DOES [blank] ANNA LIKE
  await build(max, [0,3,0,0,5]); // WHO DID [blank] TOM CALL
  await layout(anna, 'object');
  await layout(teacher, 'teacher');
  await build(anna, [0,2,1,1,4]); // Deliberately invalid: WHO DOES HELPS ANNA LIKE
  await anna.reload();
  await row(anna, '#my-cubes', positions.get(anna));
  await anna.locator('#bell').click();
  assert.equal(await anna.locator('#my-cubes button:disabled').count(), 5);
  await teacher.locator('.student-card').first().getByText('🔔 Finished · Locked').waitFor();
  const frozen = await anna.locator('#my-cubes .cube-control').evaluateAll(c => c.map(x => x.getAttribute('aria-label')));
  await anna.locator('#my-cubes button').evaluateAll(buttons => buttons.forEach(button => button.click()));
  assert.deepEqual(await anna.locator('#my-cubes .cube-control').evaluateAll(c => c.map(x => x.getAttribute('aria-label'))), frozen);
  assert.equal(await anna.locator('#partner-question').isVisible(), false);
  assert.equal(await max.locator('#partner-question').isVisible(), false);
  await turn(max, 4);
  await max.locator('#bell').click();
  await anna.locator('#partner-question').waitFor();
  await max.locator('#partner-question').waitFor();
  assert.equal(await max.locator('#my-cubes button:disabled').count(), 5);
  await row(anna, '#partner-question', positions.get(max));
  await row(max, '#partner-question', positions.get(anna));
  await layout(anna, 'compare');
  await anna.reload();
  await row(anna, '#partner-question', positions.get(max));
  assert.equal(await anna.locator('#my-cubes button:disabled').count(), 5);
  await teacher.getByRole('button', {name:'NEW ROUND'}).click();
  for (const page of [anna,max]) {
    await page.locator('#my-cubes button:enabled').first().waitFor();
    assert.equal(await page.locator('#my-cubes button:enabled').count(), 5);
    assert.equal(await page.locator('#partner-question').isVisible(), false);
    assert.equal(await page.locator('#bell').isEnabled(), true);
    await row(page, '#my-cubes', positions.get(page));
  }
  assert.equal(await teacher.locator('#room-code').textContent(), code);
  await build(anna, [0,0,10,0,0]);
  await build(max, [0,1,0,2,1]);
  await anna.locator('#bell').click();
  await max.locator('#bell').click();
  await anna.locator('#partner-question').waitFor();
  await max.locator('#partner-question').waitFor();
  await row(anna, '#partner-question', positions.get(max));
  await row(max, '#partner-question', positions.get(anna));
  assert.deepEqual(errors, []);
  console.log('Level 4 five-cube browser check passed: all cycles and blanks, both manual patterns, invalid combination preserved, live sync, five-cube locking/reveal, reload, NEW ROUND, second round, and desktop/tablet/mobile layouts.');
} finally {
  await context.close(); await browser.close(); server.closeAllConnections(); server.close();
}
