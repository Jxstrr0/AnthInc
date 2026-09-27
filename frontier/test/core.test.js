const assert = require('assert');
const FR = require('./_load')(['01_core.js']);
const r1 = FR.rng(42), r2 = FR.rng(42);
for (let i = 0; i < 5; i++) assert.strictEqual(r1(), r2());
const r3 = FR.rng(r1.state()); assert.strictEqual(r3(), r1());   // resuming from state() continues the same stream
assert.strictEqual(FR.fmtMoney(18000000), '$18.0M');
assert.strictEqual(FR.fmtMoney(-2500), '-$2,500');
assert.strictEqual(FR.fmtMoney(1.5e9), '$1.50B');
assert.strictEqual(FR.year(52), 1); assert.strictEqual(FR.year(53), 2); assert.strictEqual(FR.weekOfYear(53), 1);
const st = { lab: { name: 'Test' }, turn: 5, money: { cash: 1 }, news: [], history: [{ a: 1 }] };
const code = FR.save.exportCode(st); assert.ok(code.startsWith('FR1.'));
assert.deepStrictEqual(FR.save.importCode(code).lab, { name: 'Test' });
assert.strictEqual(FR.save.importCode(code.slice(0, -4) + 'AAAA'), null);
assert.ok(FR.save.write(1, st)); assert.strictEqual(FR.save.info(1).turn, 5);
console.log('core ok');
