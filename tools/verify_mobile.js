/* 移动端适配验证：移动视口 + 触摸模拟 + HTTP 在线模式 + 桌面回归 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'tools', 'shots');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8'
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const full = path.resolve(ROOT, '.' + (rel === '/' ? '/index.html' : rel));
      if (!full.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
      fs.readFile(full, (err, buf) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const DEVICES = [
  { name: 'phone-390', width: 390, height: 844, dsf: 3, mobile: true, touch: true },
  { name: 'phone-360', width: 360, height: 640, dsf: 2, mobile: true, touch: true },
  { name: 'phone-320', width: 320, height: 568, dsf: 2, mobile: true, touch: true },
  { name: 'landscape-844', width: 844, height: 390, dsf: 3, mobile: true, touch: true },
  { name: 'desktop-1440', width: 1440, height: 900, dsf: 1, mobile: false, touch: false }
];

function layout() {
  const rect = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
             display: getComputedStyle(e).display };
  };
  const tb = document.getElementById('toolbar');
  const canvas = document.querySelector('canvas.wrl-canvas');
  const title = document.querySelector('.stage-title').getBoundingClientRect();
  const tool = tb.getBoundingClientRect();
  const overlap = !(title.right < tool.left || tool.right < title.left ||
                    title.bottom < tool.top || tool.bottom < title.top);
  return {
    appH: Math.round(document.querySelector('.app').getBoundingClientRect().height),
    topbar: rect('.topbar'), stage: rect('.stage'), sidebar: rect('.sidebar'),
    infobar: rect('.infobar'), gallery: rect('#galleryWrap'),
    canvas: canvas ? { w: canvas.width, h: canvas.height, cssW: Math.round(canvas.getBoundingClientRect().width),
                       touchAction: getComputedStyle(canvas).touchAction } : null,
    toolbar: { y: Math.round(tool.y), h: Math.round(tool.height), scrollW: tb.scrollWidth, clientW: tb.clientWidth,
               buttons: tb.querySelectorAll('.tbtn').length },
    titleToolbarOverlap: overlap,
    touchHint: getComputedStyle(document.querySelector('.hint-touch')).display,
    desktopHint: getComputedStyle(document.querySelector('.hint-desktop')).display,
    infoActions: getComputedStyle(document.querySelector('.info-actions')).display,
    statusbar: getComputedStyle(document.querySelector('.statusbar')).display,
    online: document.body.classList.contains('online'),
    statusText: document.getElementById('statusSource').textContent.trim()
  };
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const { server, port } = await serve();
  const baseUrl = 'http://127.0.0.1:' + port + '/index.html';
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle',
           '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });

  const report = {};
  for (const d of DEVICES) {
    const page = await browser.newPage();
    await page.setViewport({ width: d.width, height: d.height, deviceScaleFactor: d.dsf,
                             isMobile: d.mobile, hasTouch: d.touch });
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
    page.on('requestfailed', r => errors.push('requestfailed: ' + r.url().slice(-80)));
    await page.goto(baseUrl, { waitUntil: 'load', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3200));

    const info = await page.evaluate(layout);
    info.model = await page.evaluate(() => ({
      name: document.getElementById('stageName').textContent,
      stats: document.getElementById('stageStats').textContent,
      overlay: document.getElementById('overlay').className,
      cards: document.querySelectorAll('.card').length
    }));
    info.errors = errors;
    report[d.name] = info;
    await page.screenshot({ path: path.join(SHOTS, 'mobile-' + d.name + '.png') });

    // 主设备额外跑一遍完整交互
    if (d.name === 'phone-390') {
      await page.focus('#search');
      const focused = await page.evaluate(() => ({
        searching: document.body.classList.contains('searching'),
        sidebar: getComputedStyle(document.querySelector('.sidebar')).display
      }));
      await page.type('#search', '1s');
      await new Promise(r => setTimeout(r, 1400));
      const searched = await page.evaluate(() => ({
        count: document.getElementById('resultCount').textContent,
        stage: document.getElementById('stageName').textContent,
        overlay: document.getElementById('overlay').className,
        stats: document.getElementById('stageStats').textContent
      }));
      await page.screenshot({ path: path.join(SHOTS, 'mobile-search-1s.png') });
      await page.evaluate(() => document.getElementById('search').blur());
      const blurred = await page.evaluate(() => ({
        searching: document.body.classList.contains('searching'),
        sidebar: getComputedStyle(document.querySelector('.sidebar')).display
      }));

      // 工具条按钮可点击（切换浅色背景）
      await page.click('#tbBg');
      const light = await page.evaluate(() => document.getElementById('stage').classList.contains('light'));
      await page.click('#tbBg');

      // 切到总览（先清空搜索，验证完整 258 张网格）
      await page.evaluate(() => {
        const s = document.getElementById('search');
        s.value = '';
        s.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.click('#tabs button[data-view="gallery"]');
      await new Promise(r => setTimeout(r, 400));
      const gallery = await page.evaluate(() => ({
        visible: getComputedStyle(document.getElementById('galleryWrap')).display,
        sidebar: getComputedStyle(document.querySelector('.sidebar')).display,
        cards: document.querySelectorAll('.gcard').length,
        broken: Array.from(document.querySelectorAll('.gcard img')).filter(i => i.complete && !i.naturalWidth).length
      }));
      await page.screenshot({ path: path.join(SHOTS, 'mobile-gallery.png') });

      // 从总览里挑一个非 1s 的卡片返回查看器，确认切换确实生效
      const otherId = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.gcard'))
          .find(c => c.getAttribute('data-id') !== '1s').getAttribute('data-id'));
      await page.click('.gcard[data-id="' + otherId + '"]');
      await new Promise(r => setTimeout(r, 1800));
      const back = await page.evaluate(() => ({
        stage: document.getElementById('stageName').textContent,
        overlay: document.getElementById('overlay').className
      }));
      report.interaction = { focused, searched, blurred, light, gallery, otherId, back, errors: errors.slice(-5) };
      await page.screenshot({ path: path.join(SHOTS, 'mobile-after-card.png') });
    }
    await page.close();
  }

  // 桌面端 file:// 回归：确认本地双击模式没被破坏
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const fileErrors = [];
  page.on('pageerror', e => fileErrors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') fileErrors.push('console: ' + m.text().slice(0, 200)); });
  await page.goto('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/'),
                  { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3200));
  report.fileDesktop = await page.evaluate(() => ({
    online: document.body.classList.contains('online'),
    infoActions: getComputedStyle(document.querySelector('.info-actions')).display,
    sidebarX: Math.round(document.querySelector('.sidebar').getBoundingClientRect().x),
    stageX: Math.round(document.querySelector('.stage').getBoundingClientRect().x),
    toolbarY: Math.round(document.getElementById('toolbar').getBoundingClientRect().y),
    stageName: document.getElementById('stageName').textContent,
    overlay: document.getElementById('overlay').className,
    brokenThumbs: Array.from(document.querySelectorAll('.thumb img')).filter(i => i.complete && !i.naturalWidth).length
  }));
  report.fileDesktop.errors = fileErrors;
  await page.screenshot({ path: path.join(SHOTS, 'mobile-file-desktop.png') });
  await page.close();

  await browser.close();
  server.close();
  console.log(JSON.stringify(report, null, 2));
})().catch(err => { console.error('验证失败:', err); process.exit(1); });
