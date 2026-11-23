// Play the real game in headless Chromium with real keyboard and mouse input:
// title, walk, steal a car, drive, pause, shoot, punch, save and continue.
// Run with `node browser-test.mjs`. Exit 0 means every check passed.
// Needs Playwright's Chromium and playwright-core in /tmp/pw/node_modules.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire('/tmp/pw/package.json');
const { chromium } = require('playwright-core');

const PORT = 8902;
const failures = [];
const notes = [];

function check(name, ok, detail) {
  if (ok) notes.push(`PASS ${name} — ${detail}`);
  else failures.push(`FAIL ${name} — ${detail}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const server = spawn('node', [join(here, 'serve.ts'), '--port', String(PORT)], { stdio: 'pipe' });
  let serverUp = false;
  server.stdout.on('data', () => {
    serverUp = true;
  });
  for (let i = 0; i < 50 && !serverUp; i += 1) await sleep(100);
  const home = process.env.HOME ?? '';
  const candidates = [
    join(home, '.cache/ms-playwright/chromium-1148/chrome-linux/chrome'),
    join(home, '.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell'),
  ];
  const executablePath = candidates.find((p) => existsSync(p));
  if (!executablePath) throw new Error('no Chromium found under ~/.cache/ms-playwright');
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`http://localhost:${PORT}/?seed=7`, { waitUntil: 'load' });
    await sleep(800);

    const state = () => page.evaluate(() => {
      const vp = window.__vicepoint;
      if (!vp) return null;
      const w = vp.world;
      return {
        screen: vp.screen,
        x: Math.round(w.player.x),
        y: Math.round(w.player.y),
        money: w.player.money,
        health: Math.round(w.player.health),
        inCar: Boolean(w.player.inCar),
        speed: w.player.inCar ? Math.round(Math.abs(w.player.inCar.speed)) : 0,
        wanted: w.wanted,
        mission: w.missions.index,
        bullets: w.bullets.length,
        punchTimer: w.player.punchTimer,
      };
    });

    // B1 — the title screen, then Enter starts the game.
    let s = await state();
    check('B1 title screen', s && s.screen === 'title', `screen=${s && s.screen}`);
    await page.keyboard.press('Enter');
    await sleep(600);
    s = await state();
    check('B1 Enter starts', s && s.screen === 'play', `screen=${s && s.screen}`);

    // B2 — walking with W moves the player.
    const before = await state();
    await page.keyboard.down('KeyW');
    await sleep(1000);
    await page.keyboard.up('KeyW');
    s = await state();
    const moved = Math.hypot(s.x - before.x, s.y - before.y);
    check('B2 walk with W', moved > 100, `moved ${Math.round(moved)} px in 1 s`);

    // B3 — stand next to a parked car and press E to steal it.
    await page.evaluate(() => {
      const w = window.__vicepoint.world;
      const parked = w.cars.find((c) => c.kind === 'parked');
      w.player.x = parked.x + 40;
      w.player.y = parked.y + 40;
    });
    await page.keyboard.press('KeyE');
    await sleep(400);
    s = await state();
    check('B3 steal a car with E', s && s.inCar, `inCar=${s && s.inCar} wanted=${s && s.wanted}`);
    // Put the stolen car on a clear road, facing south, so the drive test is
    // a straight run instead of a wall.
    await page.evaluate(() => {
      const w = window.__vicepoint.world;
      const car = w.player.inCar;
      car.x = 674;
      car.y = 758;
      car.angle = Math.PI / 2;
      car.speed = 0;
      w.player.x = car.x;
      w.player.y = car.y;
    });

    // B4 — driving with W moves the car.
    const driveBefore = await state();
    await page.keyboard.down('KeyW');
    await sleep(1500);
    await page.keyboard.up('KeyW');
    s = await state();
    const drove = Math.hypot(s.x - driveBefore.x, s.y - driveBefore.y);
    check('B4 drive with W', s && s.inCar && drove > 200, `drove ${Math.round(drove)} px, speed ${s && s.speed} px/s`);

    // B5 — P pauses, P resumes.
    await page.keyboard.press('KeyP');
    await sleep(300);
    s = await state();
    check('B5 P pauses', s && s.screen === 'paused', `screen=${s && s.screen}`);
    await page.keyboard.press('KeyP');
    await sleep(300);
    s = await state();
    check('B5 P resumes', s && s.screen === 'play', `screen=${s && s.screen}`);

    // B6 — E gets out of the car.
    await page.keyboard.press('KeyE');
    await sleep(400);
    s = await state();
    check('B6 E exits the car', s && !s.inCar, `inCar=${s && s.inCar}`);

    // B7 — hold the mouse to shoot (a bullet flies), F punches. The bullet is
    // checked 100 ms in, before it can reach a wall.
    await page.mouse.move(900, 300);
    await page.mouse.down();
    await sleep(100);
    s = await state();
    const bullets = s && s.bullets;
    await sleep(200);
    await page.mouse.up();
    check('B7 mouse shoots', bullets > 0, `bullets=${bullets} wanted=${s && s.wanted}`);
    await page.keyboard.press('KeyF');
    await sleep(150);
    s = await state();
    check('B7 F punches', s && s.punchTimer > 0, `punchTimer=${s && (s.punchTimer || 0).toFixed(2)}`);

    // B8 — pause saves; reload and C continues with the saved money.
    await page.evaluate(() => {
      window.__vicepoint.world.player.money = 9999;
    });
    await page.keyboard.press('KeyP');
    await sleep(300);
    const saved = await page.evaluate(() => window.localStorage.getItem('vicepoint.save.v1'));
    check('B8 pause saves', Boolean(saved) && saved.includes('9999'), `save=${saved}`);
    await page.goto(`http://localhost:${PORT}/?seed=7`, { waitUntil: 'load' });
    await sleep(800);
    await page.keyboard.press('KeyC');
    await sleep(500);
    s = await state();
    check('B8 C continues the save', s && s.screen === 'play' && s.money === 9999, `screen=${s && s.screen} money=${s && s.money}`);

    // B9 — no console or page errors through the whole session.
    check('B9 no page errors', errors.length === 0, errors.length === 0 ? 'clean' : errors.join(' | '));

    await page.screenshot({ path: '/tmp/vicepoint-browser-test.jpg', type: 'jpeg', quality: 80 });
  } finally {
    await browser.close();
    server.kill();
  }
}

main()
  .then(() => {
    for (const note of notes) console.log(note);
    for (const failure of failures) console.log(failure);
    console.log(failures.length === 0 ? 'ALL BROWSER TESTS PASSED' : `${failures.length} BROWSER TEST(S) FAILED`);
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
