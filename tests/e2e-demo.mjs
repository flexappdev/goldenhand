// Browser test of the DEMO flow: public form -> lead console -> approve.
// Serves the repo over HTTP (ES modules need it) and drives Chromium.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = fileURLToPath(new URL('..', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  if (p.endsWith('/')) p += 'index.html';
  try { const b = await readFile(join(root, p)); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const shots = process.env.SHOTS;
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await page.goto(`${base}/`);
  await page.click('text=Get a quote →');
  await page.click('#sendbtn');
  const err = await page.textContent('#brief');
  if (!/name/.test(err) || !/consent|agree/.test(err)) throw new Error('validation message missing: ' + err);
  await page.fill('#name', 'Test Customer');
  await page.fill('#phone', '07700 900123');
  await page.fill('#postcode', 'nw4');
  await page.fill('#detail', 'Leaking tap under the kitchen sink');
  await page.dispatchEvent('#detail', 'change');
  if (await page.inputValue('#category') !== 'Minor plumbing') throw new Error('category not guessed');
  await page.check('#consent');
  if (shots) await page.screenshot({ path: `${shots}/1-form.png` });
  await page.click('#sendbtn');
  await page.waitForSelector('#brief:has-text("Reference")');
  const ref = (await page.textContent('#brief')).match(/GH-\d{6}-[A-Z0-9]{4}/)[0];
  if (shots) await page.screenshot({ path: `${shots}/2-sent.png` });
  console.log('ok   - submitted', ref);

  await page.goto(`${base}/leads.html`);
  await page.waitForSelector(`.row:has-text("${ref}")`);
  if (!(await page.textContent('#banner')).startsWith('DEMO')) throw new Error('DEMO banner missing');
  await page.click(`.row:has-text("${ref}")`);
  await page.click('#reject');
  await page.waitForSelector('#derr:has-text("note")');
  console.log('ok   - reject without note refused');
  await page.click('#approve');
  await page.waitForSelector('#detail .status.APPROVED');
  await page.waitForSelector('.log li:has-text("NEW → APPROVED")');
  if (shots) await page.screenshot({ path: `${shots}/3-approved.png`, fullPage: true });
  console.log('ok   - approved with audit entry');
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error('horizontal scroll on phone width');
  console.log('ok   - no horizontal scroll at phone width');
  if (errors.length) throw new Error('page errors: ' + errors.join('; '));
} finally { await browser.close(); server.close(); }
