// Take the entry's screenshots with headless Chromium: serve game/ locally,
// open each ?shot= scene from shots.json, wait until the scene says it is
// painted (window.__shotReady), and save a JPEG. A shot over the 256 KiB cap
// is retaken at lower quality until it fits.
//
//   node shots.mjs
//
// Needs Playwright's Chromium (installed once with
// `npx -y playwright install chromium`) and the playwright-core package in
// /tmp/pw/node_modules (installed once with `npm install playwright-core`).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire('/tmp/pw/package.json');
const { chromium } = require('playwright-core');

const PORT = 8901;
const SHOTS = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'));
const MAX_BYTES = 262144;

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
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (message) => {
      if (message.type() === 'error') console.log('page error:', message.text());
    });
    page.on('pageerror', (error) => console.log('page exception:', String(error)));
    for (const shot of SHOTS) {
      const url = `http://localhost:${PORT}/${shot.query}`;
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 20000 });
      await sleep(300);
      const out = join(here, 'screenshots', shot.name);
      let quality = 84;
      for (;;) {
        await page.screenshot({ path: out, type: 'jpeg', quality });
        const bytes = statSync(out).size;
        console.log(`${shot.name}: ${bytes} bytes (quality ${quality})`);
        if (bytes <= MAX_BYTES || quality <= 50) break;
        quality -= 8;
      }
      if (statSync(out).size > MAX_BYTES) throw new Error(`${shot.name} is over the 256 KiB cap`);
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log('all screenshots taken');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
