// Runs every test/*.test.js (or the ones named). Prints one line per file and "ALL PASS" or the failures.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const only = process.argv.slice(2);
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') && (!only.length || only.some(o => f.includes(o))));
let fail = 0;
files.forEach(f => {
  try { execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'pipe', timeout: 120000 }); console.log('ok   ' + f); }
  catch (e) { fail++; console.log('FAIL ' + f + '\n' + String(e.stdout || '') + String(e.stderr || '').split('\n').slice(0, 30).join('\n')); }
});
console.log(fail ? fail + ' FAILED' : 'ALL PASS');
process.exit(fail ? 1 : 0);
