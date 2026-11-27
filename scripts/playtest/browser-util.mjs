import fs from 'node:fs';
import { chromium } from 'playwright-core';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

export function findChromeExecutable() {
  for (const p of CHROME_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`No Chrome/Edge executable found in: ${CHROME_CANDIDATES.join(', ')}`);
}

export async function launchSharedBrowser() {
  const executablePath = findChromeExecutable();
  return chromium.launch({
    executablePath,
    headless: true,
    args: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });
}

export function buildAppUrl({
  baseUrl = 'http://localhost:5173',
  roomCode = null,
  batchId = null,
  source = 'ui-playtest',
  tester = null,
  targetFloors = null,
  monitor = false,
} = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set('peerHost', 'localhost');
  url.searchParams.set('peerPort', '9000');
  url.searchParams.set('peerPath', '/peerjs');
  url.searchParams.set('peerSecure', 'false');
  if (roomCode) url.searchParams.set('room', roomCode);
  if (batchId) url.searchParams.set('batch', batchId);
  if (source) url.searchParams.set('source', source);
  if (tester) url.searchParams.set('tester', tester);
  if (targetFloors) url.searchParams.set('targetFloors', String(targetFloors));
  if (monitor) url.searchParams.set('monitor', '1');
  return url.toString();
}

export async function dismissCoachmarkIfAny(page) {
  try {
    const skipAll = page.locator('#coach-skip-all');
    if (await skipAll.first().isVisible({ timeout: 350 })) {
      await skipAll.first().click();
      return true;
    }
    const skip = page.locator(
      '#coach-skip, .coach-skip, [data-coach-skip], button:has-text("Skip all tips"), button:has-text("Skip tips"), button:has-text("Got it")',
    );
    if (await skip.first().isVisible({ timeout: 350 })) {
      await skip.first().click();
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
