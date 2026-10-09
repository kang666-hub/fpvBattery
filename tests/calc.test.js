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
  assert.equal(r['儲存'].total, '15.4'); assert.equal(r['建議降落'].total, '14.4');
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
  assert.equal(ctx.chargeMinutes(15000, l.actual), 72);
});
test('6 200W 限制', () => {
  const cur = ctx.chargeCurrent(15000, 1), fv = ctx.fullVoltage('lipo', 6);
  const l = ctx.limitedCurrent(cur, fv, 200);
  assert.ok(l.limited); assert.equal(l.actual.toFixed(1), '7.9');
  assert.equal((l.actual / 15).toFixed(2), '0.53');
  const m = ctx.chargeMinutes(15000, l.actual);
  assert.equal(ctx.formatDuration(m), '2 小時 17 分');
});
test('容量0不顯示時間', () => assert.equal(ctx.chargeMinutes(0, 1), null));
