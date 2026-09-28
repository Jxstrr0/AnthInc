// V0.5 (owner call after V0.4): a renewal settled while the account's sector is hot carries the hot fee (+25%) for its
// new term; a renewal in a normal sector reprices plainly and drops an earlier hot flag; the meeting card shows the hot fee.
const assert = require('assert');
const FR = require('./_load')();
const A = FR.accounts, K = A.K;

const rep = (t) => ({ turn: t, events: [], memo: [], news: [], flows: {}, commands: [] });
function game() {
  const s = FR.sim.newGame({ seed: 5 });
  s.money.cash = 50e6; s.market.trust = 60; FR.SKILLS.forEach(k => { s.model.skills[k].cap = 30; s.model.skills[k].safe = 30; });
  s.accounts.unlocked = true; s.accounts.refreshAt = 9999; s.accounts.sectors.nextAt = 9999;
  return s;
}
function end(hot, extra) {
  const s = game(), T = s.turn;
  if (hot) s.accounts.sectors.hot = { name: 'Retail', from: T - 3, until: T + 10 };
  const a = Object.assign({ id: 'H1', name: 'Hot Buyer', sector: 'Retail', tier: 1, pfPerWeek: 10, feePerWeek: A.fee(1, T), ends: T, signed: T - 50,
    starts: T - 48, mood: 72, served: 0, turns: 52, meeting: { opens: T - 8, answer: 'renew' }, ask: null, field: 0 }, extra || {});
  s.accounts.active.push(a);
  const q = rep(T); A.step(s, { serving: { pf: 1000 } }, FR.rng(7), q);
  return { s, a, q };
}
const hotFee = (tier, t) => Math.round(A.fee(tier, t) * K.sector.hotFee / 1000) * 1000;

let r = end(true);
assert.strictEqual(r.a.feePerWeek, hotFee(1, r.s.turn + 1), 'hot renewal at +25%');
assert.ok(r.a.hot, 'the renewed contract is marked hot');
assert.ok(r.q.events.some(e => e.type === 'account:renewed' && e.hot === true));
assert.ok(r.q.memo.some(m => /renews in a hot sector for 52 weeks/.test(m.text)), JSON.stringify(r.q.memo.map(m => m.text)));

r = end(false, { hot: true, feePerWeek: hotFee(1, 1) });
assert.strictEqual(r.a.feePerWeek, A.fee(1, r.s.turn + 1), 'a normal-sector renewal reprices at the plain fee');
assert.ok(!r.a.hot, 'the hot flag from the old term is dropped');

// push up in a hot sector: the new tier's fee, +25%
r = end(true, { mood: 86, meeting: { opens: 1, answer: 'up' } });
assert.strictEqual(r.a.tier, 2); assert.strictEqual(r.a.feePerWeek, hotFee(2, r.s.turn + 1));

// the meeting card previews the hot fee and says it depends on the swing lasting
const s = game(), T = s.turn;
s.accounts.sectors.hot = { name: 'Retail', from: T, until: T + 20 };
const a = { id: 'M1', name: 'Card Buyer', sector: 'Retail', tier: 1, pfPerWeek: 10, feePerWeek: A.fee(1, T), ends: T + 5, signed: T - 50, starts: T - 48,
  mood: 64, served: 0, turns: 52, meeting: { opens: T - 3, answer: null }, ask: null, field: 0 };
s.accounts.active.push(a);
const v = A.meetingView(s, a);
assert.ok(v.renew.text.indexOf(FR.fmtMoney(hotFee(1, a.ends + 1)) + ' (hot sector +25%, if still hot then)') >= 0, v.renew.text);
s.accounts.sectors.hot = null;
assert.ok(A.meetingView(s, a).renew.text.indexOf('hot sector') < 0);
console.log('v05 ok');
