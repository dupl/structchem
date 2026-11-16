/* 诊断指定模型的词法/语法错误细节 */
const path = require('path');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ids = (process.argv[2] || 'CH4-2').split(',');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle',
           '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  page.on('console', async msg => {
    if (msg.type() !== 'error') return;
    for (const a of msg.args()) {
      try { console.log('ERR:', JSON.stringify(await a.jsonValue()).slice(0, 2000)); }
      catch (e) { console.log('ERR(raw):', msg.text()); }
    }
  });
  page.on('pageerror', e => console.log('PAGEERR:', e.message));
  await page.goto('file:///' + path.join(ROOT, 'thumb.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  for (const id of ids) {
    console.log('====', id);
    try {
      const text = await page.evaluate(i => WRL.load(i), id);
      console.log('  length', text.length);
      const n = await page.evaluate(t => {
        const saved = console.error;
        const errs = [];
        console.error = function () {
          for (const a of arguments) {
            try { errs.push(JSON.stringify(a).slice(0, 1200)); }
            catch (e) { errs.push(String(a)); }
          }
        };
        let result;
        try { WRLCore.parseModel(t); result = 'OK'; } catch (e) { result = String(e); }
        console.error = saved;
        return { result: result, errors: errs };
      }, text);
      console.log('  parse:', JSON.stringify(n).slice(0, 2500));
    } catch (e) { console.log('  load error', e.message); }
  }
  await browser.close();
})();
