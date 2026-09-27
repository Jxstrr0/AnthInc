// Loads the pure sim modules into globalThis.FR for node tests. Usage: const FR = require('./_load')();
const fs = require('fs'), path = require('path'), vm = require('vm');
const SIM = ['01_core.js', '02_sim.js', '03_model.js', '04_compute.js', '05_money.js', '06_market.js', '07_projects.js'];
module.exports = function load(files) {
  delete globalThis.FR;
  (files || SIM).forEach(f => {
    const p = path.join(__dirname, '..', 'src', f);
    if (fs.existsSync(p)) vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p });
  });
  const mem = {}; globalThis.FR.save.useStore({ getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } });
  return globalThis.FR;
};
