/* 抽样检验大型/复杂模型在主查看器中的加载 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'tools', 'shots');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TERMS = ['CH4-2', 'ben-1', '2Dbox11', 'C2v-1', 'quartz', 'Oh-1', '4fz3', 'A3-4', 'H2O-3', '3DBOX111'];

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle',
           '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await page.goto('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 2500));

  for (const term of TERMS) {
    await page.evaluate(() => {
      const i = document.getElementById('search');
      i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.type('#search', term);
    await new Promise(r => setTimeout(r, 2600));
    const s = await page.evaluate(() => ({
      count: document.getElementById('resultCount').textContent,
      stage: document.getElementById('stageName').textContent,
      stats: document.getElementById('stageStats').textContent,
      overlay: document.getElementById('overlay').className,
      status: document.getElementById('statusRight').textContent
    }));
    console.log(term.padEnd(12), JSON.stringify(s));
    await page.screenshot({ path: path.join(SHOTS, 'sample-' + term.replace(/[^\w-]/g, '_') + '.png') });
  }
  console.log('错误数:', errs.length);
  errs.slice(0, 10).forEach(e => console.log('  ', e));
  await browser.close();
})();
