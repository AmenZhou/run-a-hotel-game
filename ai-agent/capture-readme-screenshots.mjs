/**
 * Generates PNGs for the repo root README (docs/screenshots/).
 * Run from ai-agent: node capture-readme-screenshots.mjs
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const gameUrl = `file://${path.join(repoRoot, 'grand_hotel_blueprint.html')}`;
const outDir = path.join(repoRoot, 'docs', 'screenshots');

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(gameUrl, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
    () => window.state && Array.isArray(window.state.hotel) && window.state.hotel.length > 1,
    { timeout: 45_000 }
);
await page.waitForTimeout(2500);

await page.screenshot({ path: path.join(outDir, 'isometric-overview.png') });

await page.evaluate(() => {
    if (typeof state !== 'undefined') state.isoYaw = Math.PI / 9; // 20°
});
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(outDir, 'rotated-overlook.png') });

await page.evaluate(() => {
    if (typeof state !== 'undefined') {
        state.isoYaw = 0;
        state.viewMode = 'firstperson';
        state.fpFloor = 1;
        state.fpRoom = null;
    }
});
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(outDir, 'first-person-corridor.png') });

await browser.close();
console.log('Wrote screenshots to', outDir);
