/* 扫描所有模型：找出含 NaN 顶点或异常包围球的模型 */
const path = require('path');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle',
           '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage();
  await page.goto('file:///' + path.join(ROOT, 'thumb.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  const ids = await page.evaluate(() => window.thumbIds());
  const bad = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const r = await page.evaluate(async (x) => {
      const text = await WRL.load(x);
      const g = WRLCore.parseModel(text);
      let nan = 0, geoms = 0;
      g.traverse(o => {
        if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
        geoms++;
        const a = o.geometry.attributes.position.array;
        for (let k = 0; k < a.length; k++) if (!isFinite(a[k])) { nan++; break; }
      });
      const b = WRLCore.boundsOf(g);
      return { nan: nan, geoms: geoms, radius: b.radius, finite: isFinite(b.radius) };
    }, id);
    if (r.nan || !r.finite) bad.push([id, r]);
    if ((i + 1) % 50 === 0) console.log('  scanned', i + 1);
  }
  console.log('异常模型:', JSON.stringify(bad, null, 1));
  await browser.close();
})();
