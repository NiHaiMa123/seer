const { chromium } = require('@playwright/test');
const fs = require('fs');
const FIELDS = '名称|类型|系列名称|初始攻击|初始防御|初始特攻|初始特防|初始速度|初始体力|隐藏攻击|隐藏防御|隐藏特攻|隐藏特防|隐藏速度|隐藏体力|专属精灵|最大装备等级|最大持有数量|描述'.split('|').map(f=>'?'+f).join('|');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  // 先访问一次图鉴页拿 cookie/会话
  await p.goto('https://wiki.biligame.com/seer/%E5%88%BB%E5%8D%B0%E5%9B%BE%E9%89%B4', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(2000);
  const all = {};
  let offset = 0;
  for (let page = 0; page < 30; page++) {
    const q = encodeURIComponent('[[Category:刻印]]|' + FIELDS + '|limit=200|offset=' + offset);
    let d = null;
    for (let retry = 0; retry < 4 && d === null; retry++) {
      const r = await p.request.get('https://wiki.biligame.com/seer/api.php?action=ask&query=' + q + '&format=json');
      const t = await r.text();
      try { d = JSON.parse(t); } catch { console.log('page', offset, 'retry', retry, 'status', r.status()); await p.waitForTimeout(1500 * (retry + 1)); }
    }
    if (d === null) break;
    const res = d.query?.results ?? {};
    const n = Object.keys(res).length;
    Object.assign(all, res);
    const cont = d['query-continue-offset'];
    console.log('offset', offset, 'got', n, 'total', Object.keys(all).length, 'cont', cont);
    if (n === 0 || cont === undefined || cont <= offset) break;
    offset = cont;
    await p.waitForTimeout(1200);
  }
  fs.writeFileSync('artifacts/seals-raw.json', JSON.stringify(all));
  console.log('TOTAL', Object.keys(all).length);
  await b.close();
})().catch(e => console.error('ERR', e.message));
