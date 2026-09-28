// V0.2 owner calls: incidents halve serving revenue for 3 weeks; the founders can close the lab; watch from gap 5.
const assert = require('assert');
const FR = require('./_load')();
const s = FR.sim.newGame({ seed: 7 });
const pf = 50, base = FR.money.revenue(s, pf);
assert.ok(base > 0);
s.model.skills.agents.incidents.push(s.turn);
assert.strictEqual(FR.money.underReview(s), true);
assert.ok(Math.abs(FR.money.revenue(s, pf) - base * 0.5) < 1e-6, 'revenue halved under review');
s.turn += 3; assert.strictEqual(FR.money.underReview(s), true, 'third week after still under review');
s.turn += 1; assert.strictEqual(FR.money.underReview(s), false, 'review ends after 3 weeks');
// close the lab
const g = FR.sim.newGame({ seed: 3 });
const r = FR.sim.applyCommands(g, [{ type: 'retire' }]);
assert.ok(r.results[0].ok); assert.strictEqual(r.state.status, 'exited'); assert.strictEqual(r.state.end.cause, 'retired');
assert.ok(!FR.sim.score(r.state).parts.some(p => p.label === 'Acquired'), 'retiring is not an acquisition');
assert.strictEqual(FR.sim.endTurn(r.state, []), r.state, 'a closed lab does not resolve turns');
assert.strictEqual(FR.sim.applyCommands(r.state, [{ type: 'retire' }]).results[0].ok, false);
// watch from gap 5
const w = FR.sim.newGame({ seed: 1 }); w.model.skills.coding.cap = 20; w.model.skills.coding.safe = 14;
assert.strictEqual(FR.model.outlook(w, 'coding').level, 'watch');
w.model.skills.coding.safe = 15; assert.strictEqual(FR.model.outlook(w, 'coding').level, 'ok');
console.log('v02 ok');
