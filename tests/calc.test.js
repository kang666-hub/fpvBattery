const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = html.match(/<script id="calc">([\s\S]*?)<\/script>/)[1];
const ctx = {}; vm.createContext(ctx); vm.runInContext(code, ctx);
const rows = (t, s) => Object.fromEntries(ctx.voltageRows(t, s).map(r => [r.name.split('（')[0], r]));

test('1 預設 LiPo 3S 1500 1C', () => {
  assert.equal(ctx.chargeCurrent(1500, 1).toFixed(1), '1.5');
  assert.equal(ctx.fullVoltage('lipo', 3).toFixed(2), '12.60');
  assert.equal(ctx.nominalVoltage('lipo', 3).toFixed(1), '11.1');
});
test('2 6S LiPo', () => {
  const r = rows('lipo', 6);
  assert.equal(r['儲存'].total, '22.8–23.1'); assert.equal(r['建議降落'].total, '21.6');
  assert.equal(r['最低不要低於'].total, '21.0'); assert.equal(r['過放'].total, '低於 18.0'); assert.equal(r['滿電'].total, '25.2');
  assert.equal(ctx.fullVoltage('lipo', 6).toFixed(2), '25.20');
});
test('3 4S LiHV', () => {
  const r = rows('lihv', 4);
  assert.equal(ctx.fullVoltage('lihv', 4).toFixed(2), '17.40');
  assert.equal(r['儲存'].total, '15.2–15.4'); assert.equal(r['建議降落'].total, '14.4');
});
test('4 4S Li-ion', () => {
  const r = rows('lion', 4);
  assert.equal(r['儲存'].total, '14.4–14.8'); assert.equal(r['建議降落'].total, '12.8');
  assert.equal(r['最低不要低於'].total, '12.0'); assert.equal(r['過放'].total, '低於 10.0');
});
test('5 6S 15000 1C 無限制', () => {
  const cur = ctx.chargeCurrent(15000, 1), fv = ctx.fullVoltage('lipo', 6);
  const l = ctx.limitedCurrent(cur, fv, 0);
  assert.equal(l.actual.toFixed(1), '15.0'); assert.equal(ctx.requiredPower(cur, fv), 378);
  assert.deepEqual({ ...ctx.chargeTimes(15000, l.actual) }, { theory: 60, low: 66, high: 78 });
});
test('6 200W 限制', () => {
  const cur = ctx.chargeCurrent(15000, 1), fv = ctx.fullVoltage('lipo', 6);
  const l = ctx.limitedCurrent(cur, fv, 200);
  assert.ok(l.limited); assert.equal(l.actual.toFixed(1), '7.9');
  assert.equal((l.actual / 15).toFixed(2), '0.53');
  const m = ctx.chargeTimes(15000, l.actual);
  assert.equal(ctx.formatDuration(m.theory), '1 小時 54 分');
  assert.equal(ctx.formatRange(m.low, m.high), '2 小時 5 分–2 小時 28 分');
});
test('容量0不顯示時間', () => assert.equal(ctx.chargeTimes(0, 1), null));
test('切換類型倍率規則', () => {
  assert.equal(ctx.cOnTypeChange('lion', 1), 0.2);
  assert.equal(ctx.cOnTypeChange('lion', 2), 0.2);
  assert.equal(ctx.chargeCurrent(1500, ctx.cOnTypeChange('lion', 1)).toFixed(1), '0.3');
  assert.equal(ctx.cOnTypeChange('lipo', 0.2), 1);
  assert.equal(ctx.cOnTypeChange('lihv', 0.5), 0.5);
  assert.equal(ctx.cOnTypeChange('lipo', 2), 2);
});
test('LiPo 6S 1300mAh 2C', () => {
  const cur = ctx.chargeCurrent(1300, 2), fv = ctx.fullVoltage('lipo', 6);
  assert.equal(cur.toFixed(1), '2.6'); assert.equal(fv.toFixed(2), '25.20'); assert.equal(ctx.requiredPower(cur, fv), 66);
  const t = ctx.chargeTimes(1300, cur);
  assert.equal(t.theory, 30); assert.equal(ctx.formatRange(t.low, t.high), '33–39 分鐘');
});
test('4S LiHV 儲存範圍', () => assert.equal(rows('lihv', 4)['儲存'].total, '15.2–15.4'));
test('S 數上限 6', () => { assert.equal(ctx.clampS(8), 6); assert.equal(ctx.clampS(0), 1); assert.equal(ctx.clampS(4), 4); });

test('formatRange 跨 90 分鐘統一小時格式', () => {
  assert.equal(ctx.formatRange(85, 100), '1 小時 25 分–1 小時 40 分');
  assert.equal(ctx.formatRange(33, 39), '33–39 分鐘');
});
const H = (o) => ctx.healthAssess({ type: 'lipo', s: 6, cap: 1300, ir: [], fv: [], pv: [], checks: [], ...o });
test('H-A 健康 100 綠', () => { const r = H({ ir: [3, 3, 4, 3, 4, 3] }); assert.equal(r.score, 100); assert.equal(r.level, 'green'); });
test('H-B 黃燈 55 指名 Cell 4', () => {
  const r = H({ ir: [8, 9, 10, 18, 9, 8] });
  assert.equal(r.score, 55); assert.equal(r.level, 'yellow'); assert.equal(r.metrics.weakest, 4);
  // L：降落 3.70 / 22.2V，不出現「可 2C」
  assert.equal(r.landing.perCell.toFixed(2), '3.70'); assert.equal(r.landing.total.toFixed(1), '22.2');
  const all = JSON.stringify(r); assert.ok(all.includes('3.70V/cell（6S 約 22.2V）')); assert.ok(!all.includes('可 2C')); assert.ok(!all.includes('可快充'));
});
test('H-C 橘燈 45 指名 Cell 4', () => {
  const r = H({ ir: [10, 12, 11, 28, 12, 13] });
  assert.equal(r.score, 45); assert.equal(r.level, 'orange'); assert.equal(r.metrics.weakest, 4);
  assert.ok(!JSON.stringify(r).includes('可快充'));
});
test('H-D 勾選鼓包紅燈', () => {
  const r = H({ checks: ['電池鼓包'] });
  assert.equal(r.level, 'red'); assert.equal(r.score, null); assert.equal(r.conclusion, '不要再充電或飛行，建議退役回收。');
  assert.ok(r.reasons.join('').includes('勾選了：電池鼓包'));
});
test('H-E 全空灰燈無分數', () => { const r = H({}); assert.equal(r.level, 'gray'); assert.equal(r.score, null); });
test('H-F 1S 450mAh IR 25 不紅、有參考提示', () => {
  const r = H({ s: 1, cap: 450, ir: [25] });
  assert.equal(r.level, 'blue'); assert.equal(r.score, null); assert.equal(r.label, '正常｜資料有限，持續觀察'); assert.ok(r.reasons.join('').includes('無法和其他 cell 比較')); assert.ok(r.notes.irScope.includes('只能參考各 cell 之間的差距'));
});
test('H-G 落差<3 不算倍率 100 分', () => { assert.equal(H({ ir: [1, 1, 2, 1, 1, 1] }).score, 100); });
test('H-H 飛完 Cell 3 過放紅燈', () => {
  const r = H({ pv: [3.75, 3.74, 2.90, 3.75, 3.74, 3.75] });
  assert.equal(r.level, 'red'); const t = r.reasons.join(''); assert.ok(t.includes('Cell 3') && t.includes('曾經過放'));
});
test('H-I IR 只填 3 顆不計算', () => {
  const r = H({ ir: [3, 3, 4, '', '', ''] });
  assert.equal(r.notes.ir, '請填完 6 顆，或全部留空'); assert.equal(r.level, 'gray'); assert.equal(r.metrics.avgIR, null);
});
test('H-J 單 cell > 30mΩ 紅燈', () => { assert.equal(H({ ir: [10, 12, 11, 32, 12, 13] }).level, 'red'); });
test('H-K 滿電壓差 0.07 → 75 藍', () => {
  const r = H({ fv: [4.20, 4.19, 4.20, 4.13, 4.20, 4.20] });
  assert.equal(r.score, 75); assert.equal(r.level, 'blue');
});
test('H 內阻絕對值僅限 LiPo/LiHV 850–2500mAh', () => {
  assert.equal(H({ cap: 5000, ir: [10, 12, 11, 12, 12, 13] }).score, 100);
  const li = H({ type: 'lion', ir: [25, 25, 25, 25, 25, 25] });
  assert.equal(li.level, 'green'); assert.ok(li.notes.irScope);
});

test('formatDuration／formatRange 整點不顯示 0 分', () => {
  assert.equal(ctx.formatDuration(300), '5 小時'); assert.equal(ctx.formatDuration(125), '2 小時 5 分');
  assert.equal(ctx.formatRange(300, 360), '5 小時–6 小時');
});
test('儲存電壓文字隨類型', () => {
  assert.equal(ctx.storeText('lipo'), '3.80–3.85'); assert.equal(ctx.storeText('lihv'), '3.80–3.85'); assert.equal(ctx.storeText('lion'), '3.60–3.70');
});
test('1S 只有飛完電壓：資料有限藍燈，過放仍紅燈', () => {
  const r = H({ s: 1, cap: 1300, pv: [3.7] }); assert.equal(r.level, 'blue'); assert.equal(r.score, null);
  assert.equal(H({ s: 1, cap: 1300, pv: [2.9] }).level, 'red');
});
