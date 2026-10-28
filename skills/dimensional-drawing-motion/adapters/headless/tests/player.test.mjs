import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { chromium } from 'playwright';

const player = readFileSync(new URL('../player.html', import.meta.url), 'utf8');

async function play(sceneJs, scene) {
  const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const html = player.replace('/*__JS__*/', () => sceneJs)
      .replace('<script>\n  const cfg', () => `<script>window.__CFG__=${JSON.stringify({ w: 320, h: 180, bg: '#fff', scene })};</script>\n<script>\n  const cfg`);
    await page.setContent(html, { waitUntil: 'load' });
    const result = await page.evaluate(() => ({ ready: window.__READY__ === true, content: document.getElementById('stage').textContent }));
    return { ...result, errors };
  } finally {
    await browser.close();
  }
}

const register = id => `kit.scene(${JSON.stringify(id)}, { init(kit) { kit.stage.textContent = ${JSON.stringify(id)}; }, render() {} });`;

test('an explicit missing scene cannot export the first registered scene', async () => {
  const result = await play(register('drawing'), 'typo');
  assert.equal(result.ready, false);
  assert.equal(result.content, '');
  assert.deepEqual(result.errors, ['Unknown scene: typo']);
});

test('an inherited property is not a registered scene', async () => {
  const result = await play(register('drawing'), 'constructor');
  assert.equal(result.ready, false);
  assert.deepEqual(result.errors, ['Unknown scene: constructor']);
});

for (const id of ['__proto__', 'constructor', 'toString']) {
  test(`registered scene ${id} works as the default`, async () => {
    assert.deepEqual(await play(register(id), null), { ready: true, content: id, errors: [] });
  });
}

test('default and explicit selection preserve ordinary multiple scenes', async () => {
  const scenes = register('first') + register('second');
  assert.deepEqual(await play(scenes, null), { ready: true, content: 'first', errors: [] });
  assert.deepEqual(await play(scenes, 'second'), { ready: true, content: 'second', errors: [] });
});

test('an empty registry reports its cause', async () => {
  const result = await play('', null);
  assert.equal(result.ready, false);
  assert.deepEqual(result.errors, ['No scenes registered']);
});
