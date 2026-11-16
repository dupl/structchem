/* 离线批量生成模型缩略图。
 * 用法：node tools/make_thumbs.js [--only=id1,id2] [--smoke]
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const THUMBS = path.join(ROOT, 'data', 'thumbs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const args = process.argv.slice(2);
const smoke = args.includes('--smoke');
const onlyArg = args.find(a => a.startsWith('--only='));
const only = onlyArg ? onlyArg.split('=')[1].split(',') : null;

async function main() {
  if (!fs.existsSync(THUMBS)) fs.mkdirSync(THUMBS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--allow-file-access-from-files',
      '--disable-dev-shm-usage',
      '--window-size=900,700'
    ]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
  page.on('pageerror', err => console.error('  [页面错误]', err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') console.error('  [console]', msg.text().slice(0, 300));
  });

  const url = 'file:///' + path.join(ROOT, 'thumb.html').replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });

  let ids = await page.evaluate(() => window.thumbIds());
  if (only) ids = ids.filter(i => only.includes(i));
  if (smoke) ids = ids.slice(0, 3);
  console.log(`待生成：${ids.length} 个模型`);

  let ok = 0, fail = 0;
  const failures = [];
  for (let n = 0; n < ids.length; n++) {
    const id = ids[n];
    const out = path.join(THUMBS, id + '.jpg');
    if (!smoke && fs.existsSync(out) && fs.statSync(out).size > 500) { ok++; continue; }
    try {
      const dataUrl = await page.evaluate(
        (i) => window.renderThumbById(i, 360, 270, 'dark'), id
      );
      if (!dataUrl || !dataUrl.startsWith('data:image/jpeg')) throw new Error('未返回 JPEG');
      fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
      ok++;
    } catch (e) {
      fail++;
      failures.push([id, String(e.message || e).slice(0, 200)]);
      console.error(`  !! ${id}: ${String(e.message || e).slice(0, 160)}`);
    }
    if ((n + 1) % 25 === 0 || n + 1 === ids.length) {
      console.log(`  进度 ${n + 1}/${ids.length}  成功 ${ok}  失败 ${fail}`);
    }
  }
  console.log(`完成：成功 ${ok}，失败 ${fail}`);
  if (failures.length) console.log(JSON.stringify(failures, null, 2));
  await browser.close();
  if (fail) process.exitCode = 2;
}

main().catch(e => { console.error(e); process.exit(1); });
