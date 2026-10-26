import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'drawing-render-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const scene = join(dir, 'scene.js');
  await writeFile(scene, `kit.scene('test', {
    init(kit) { kit.stage.textContent = 'Render test'; },
    render() {}
  });`);
  const out = join(dir, 'film.mp4');
  const args = [join(here, 'render.mjs'), '--scene', scene,
    '--width', '64', '--height', '64', '--duration', '1', '--fps', '1', '--out', out];
  return { out, run: extra => exec(process.execPath, [...args, ...extra], { timeout: 30000 }) };
}

test('reports encoder failure and does not claim a successful export', async t => {
  const { out, run } = await fixture(t);
  await assert.rejects(run(['--crf', 'invalid']), error => {
    assert.equal(typeof error.code, 'number');
    assert.notEqual(error.code, 0);
    assert.match(error.stderr, /ffmpeg exited/);
    assert.doesNotMatch(error.stdout, /frames →/);
    return true;
  });
  await assert.rejects(readFile(out), { code: 'ENOENT' });
});

test('reports an encoder that fails before accepting all frames without hanging', async t => {
  const { run } = await fixture(t);
  await assert.rejects(run(['--duration', '10', '--fps', '30', '--crf', 'invalid']), error => {
    assert.equal(typeof error.code, 'number');
    assert.notEqual(error.code, 0);
    assert.equal(error.killed, false);
    assert.doesNotMatch(error.stdout, /frames →/);
    return true;
  });
});

test('reports a missing encoder without hanging', async t => {
  const { run, out } = await fixture(t);
  await assert.rejects(run(['--ffmpeg', join(dirname(out), 'missing-ffmpeg')]), error => {
    assert.equal(typeof error.code, 'number');
    assert.notEqual(error.code, 0);
    assert.equal(error.killed, false);
    assert.match(error.stderr, /ffmpeg not found/);
    assert.doesNotMatch(error.stdout, /frames →/);
    return true;
  });
});

test('reports success after writing a valid MP4', async t => {
  const { out, run } = await fixture(t);
  const { stdout, stderr } = await run([]);
  assert.match(stdout, /1 frames →/);
  assert.equal(stderr, '');
  const file = await readFile(out);
  assert.equal(file.toString('ascii', 4, 8), 'ftyp');
});
