import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'drawing-options-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const scene = join(dir, 'scene.js');
  await writeFile(scene, `kit.scene('test', {
    init(kit) { kit.stage.textContent = 'Timeline validation'; },
    render(t, kit) { kit.stage.style.opacity = String(Number.isFinite(t) ? 1 : 0); }
  });`);
  const out = join(dir, 'frame.png');
  const args = [join(here, 'render.mjs'), '--scene', scene,
    '--width', '64', '--height', '64', '--out', out];
  return { out, run: extra => exec(process.execPath, [...args, ...extra], { timeout: 90000 }) };
}

for (const [name, value] of [
  ['still', 'NaN'], ['still', 'Infinity'],
  ['duration', 'Infinity'], ['duration', 'NaN'], ['duration', '0'],
  ['duration', '-1'], ['duration', ''],
  ['fps', 'Infinity'], ['fps', '0'], ['fps', '-1'],
  ['width', '0'], ['height', '-1'], ['width', '1.5'],
]) {
  test(`rejects --${name} ${JSON.stringify(value)} before rendering`, async t => {
    const { run, out } = await fixture(t);
    await assert.rejects(run([`--${name}`, value]), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /invalid /);
      assert.doesNotMatch(error.stdout, /still →|frames →/);
      return true;
    });
    await assert.rejects(readFile(out), { code: 'ENOENT' });
  });
}

for (const name of ['still', 'duration', 'fps', 'width', 'height']) {
  test(`rejects a missing --${name} value`, async t => {
    const { run } = await fixture(t);
    await assert.rejects(run([`--${name}`]), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /invalid /);
      return true;
    });
  });
}

for (const [duration, fps] of [['0.01', '1'], ['1e308', '1e308']]) {
  test(`rejects an unusable frame count (${duration} seconds, ${fps} fps)`, async t => {
    const { run } = await fixture(t);
    await assert.rejects(run(['--duration', duration, '--fps', fps]), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /safe frame count/);
      return true;
    });
  });
}

for (const time of ['-0.25', '0', '0.25']) {
  test(`renders a real PNG at valid still time ${time}`, async t => {
    const { run, out } = await fixture(t);
    const { stdout } = await run(['--still', time]);
    assert.match(stdout, /still →/);
    const png = await readFile(out);
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 64);
    assert.equal(png.readUInt32BE(20), 64);
  });
}

test('renders a real MP4 with fractional duration and frame rate', async t => {
  const { run, out } = await fixture(t);
  const mp4 = out.replace(/png$/, 'mp4');
  const { stdout } = await run(['--duration', '0.8', '--fps', '1.25', '--out', mp4]);
  assert.match(stdout, /1 frames →/);
  assert.equal((await readFile(mp4)).toString('ascii', 4, 8), 'ftyp');
});
