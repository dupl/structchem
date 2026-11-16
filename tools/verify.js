/* 端到端验证：file:// 直接打开、搜索、渲染、截图 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'tools', 'shots');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle',
           '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--allow-file-access-from-files', '--window-size=1600,1000']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 250)); });
  page.on('requestfailed', r => errors.push('requestfailed: ' + r.url().slice(-90)));

  const url = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3500));

  const base = await page.evaluate(() => ({
    total: document.getElementById('totalCount').textContent,
    results: document.getElementById('resultCount').textContent,
    name: document.getElementById('stageName').textContent,
    stats: document.getElementById('stageStats').textContent,
    overlay: document.getElementById('overlay').className,
    cards: document.querySelectorAll('.card').length,
    canvas: !!document.querySelector('canvas.wrl-canvas'),
    info: document.getElementById('infoDesc').textContent,
    brokenThumbs: Array.from(document.querySelectorAll('.thumb img'))
      .filter(i => !i.complete || i.naturalWidth === 0).length
  }));
  console.log('初始状态:', JSON.stringify(base));
  await page.screenshot({ path: path.join(SHOTS, '01-initial.png') });

  // 搜索 1s
  await page.click('#search');
  await page.type('#search', '1s');
  await new Promise(r => setTimeout(r, 600));
  const s1 = await page.evaluate(() => ({
    count: document.getElementById('resultCount').textContent,
    first: document.querySelector('.card .card-name') && document.querySelector('.card .card-name').textContent,
    cards: document.querySelectorAll('.card').length
  }));
  console.log('搜索 "1s":', JSON.stringify(s1));
  await page.screenshot({ path: path.join(SHOTS, '02-search-1s.png') });

  // 点第一个结果
  await page.click('.card');
  await new Promise(r => setTimeout(r, 2500));
  const s2 = await page.evaluate(() => ({
    stage: document.getElementById('stageName').textContent,
    stats: document.getElementById('stageStats').textContent,
    overlay: document.getElementById('overlay').className
  }));
  console.log('点击结果:', JSON.stringify(s2));
  await page.screenshot({ path: path.join(SHOTS, '03-selected.png') });

  // 搜索 3d，点击一个 d 轨道
  await page.evaluate(() => { const i = document.getElementById('search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.type('#search', '3d');
  await new Promise(r => setTimeout(r, 400));
  await page.click('.card:nth-of-type(1)').catch(() => {});
  await new Promise(r => setTimeout(r, 2500));
  const s3 = await page.evaluate(() => ({
    count: document.getElementById('resultCount').textContent,
    stage: document.getElementById('stageName').textContent,
    stats: document.getElementById('stageStats').textContent,
    overlay: document.getElementById('overlay').className
  }));
  console.log('搜索 "3d" 并打开:', JSON.stringify(s3));
  await page.screenshot({ path: path.join(SHOTS, '04-3d.png') });

  // 总览
  await page.click('#tabs button[data-view="gallery"]');
  await new Promise(r => setTimeout(r, 900));
  const s4 = await page.evaluate(() => ({
    galleryCards: document.querySelectorAll('.gcard').length,
    shown: document.getElementById('galleryWrap').className,
    broken: Array.from(document.querySelectorAll('.gcard img')).filter(i => i.complete && i.naturalWidth === 0).length
  }));
  console.log('总览:', JSON.stringify(s4));
  await page.screenshot({ path: path.join(SHOTS, '05-gallery.png') });

  // 浅色背景 + 线框
  await page.click('#tabs button[data-view="search"]');
  await new Promise(r => setTimeout(r, 400));
  await page.click('#tbBg');
  await page.click('#tbWire');
  await new Promise(r => setTimeout(r, 700));
  await page.screenshot({ path: path.join(SHOTS, '06-light-wire.png') });

  console.log('错误数:', errors.length);
  errors.slice(0, 20).forEach(e => console.log('  ', e));
  await browser.close();
  if (errors.length) process.exitCode = 2;
})();
