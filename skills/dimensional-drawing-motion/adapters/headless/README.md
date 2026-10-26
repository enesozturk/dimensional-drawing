# Adapter: headless (no Claude needed)

Playwright opens `player.html`, calls the scene's `render(t)` for every frame, screenshots it, and pipes the PNGs into ffmpeg. Works with any agent or by hand.

## Needs

- Node 18+
- ffmpeg on your `PATH` (`brew install ffmpeg`, `apt install ffmpeg`, `winget install ffmpeg`)

## Run

```bash
cd skills/dimensional-drawing-motion/adapters/headless
npm install            # installs playwright + its chromium

# the reference dialog film
node render.mjs \
  --scene ../../templates/scene-dialog.js \
  --css   ../../templates/base.css \
  --out   dialog.mp4

# one frame, to check a beat
node render.mjs --scene ../../templates/scene-dialog.js --css ../../templates/base.css \
  --still 6.6 --out frame.png
```

| flag | default | |
|---|---|---|
| `--scene` | required | scene file (`kit.scene(id, { init, render })`) |
| `--css` | none | stylesheet for the stage (`templates/base.css`) |
| `--out` | `out.mp4` | MP4, or PNG with `--still` |
| `--duration` | `11` | seconds |
| `--fps` | `60` | 30 renders twice as fast |
| `--width` / `--height` | `1920` / `1080` | stage size |
| `--bg` | `#ffffff` | background |
| `--still <t>` | | render a single frame at time `t` |
| `--crf` | `16` | x264 quality (lower = bigger, sharper) |
| `--ffmpeg` | `ffmpeg` | path to ffmpeg |

Set `CHROMIUM_PATH` to use an existing Chrome/Chromium instead of the downloaded one.

Tested: Playwright 1.4x + Chromium, ffmpeg 6.1. An 11 s film at 30 fps renders in about 45 s on a laptop-class CPU.

Not tested: Remotion, Motion Canvas, GSAP, Lottie or other animation libraries.

## Regression checks

With the prerequisites above installed, run `npm test`. The checks exercise a
successful MP4 export, encoder failure, early encoder termination, and a missing
encoder. Failed exports exit nonzero and do not print the export-success message.
