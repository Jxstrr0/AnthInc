// Concatenates src/ in ORDER into dist/game.html (standalone), dist/game.artifact.html (no doctype/html/head/body)
// and "Frontier - V<ver>.html". Usage: node build.js
const fs = require('fs'), path = require('path');
const ORDER = ['01_core.js', '02_sim.js', '03_model.js', '04_compute.js', '05_money.js', '05b_accounts.js', '06_market.js', '07_projects.js',
  '08_hq_world.js', '08_hq_floors.js', '08_hq_elevator.js', '08_hq_title.js', '09_ui_chrome.js', '09_ui_hud.js', '09_ui_panels.js', '09_ui_menu.js',
  '10_audio.js', '99_main.js'];
const dir = __dirname, ver = fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim();
const js = ORDER.filter(f => fs.existsSync(path.join(dir, 'src', f)))
  .map(f => '// ---- src/' + f + '\n' + fs.readFileSync(path.join(dir, 'src', f), 'utf8')).join('\n');
const shell = fs.readFileSync(path.join(dir, 'src', '00_shell.html'), 'utf8').replace(/\{\{VERSION\}\}/g, ver);
const html = shell.replace('<!-- SCRIPTS -->', () => '<script>\nwindow.FR_VERSION="' + ver + '";\n' + js + '\n</script>');
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
fs.writeFileSync(path.join(dir, 'dist', 'game.html'), html);
const art = html.replace(/<!doctype html>/i, '').replace(/<\/?html[^>]*>/gi, '').replace(/<\/?head>/gi, '').replace(/<\/?body[^>]*>/gi, '');
fs.writeFileSync(path.join(dir, 'dist', 'game.artifact.html'), art);
fs.writeFileSync(path.join(dir, 'Frontier - V' + ver + '.html'), html);
console.log('built V' + ver + ' · ' + (html.length / 1024).toFixed(0) + ' KB · ' + ORDER.filter(f => fs.existsSync(path.join(dir, 'src', f))).length + ' modules');
