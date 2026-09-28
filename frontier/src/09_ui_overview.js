// Company overview: one sheet, opened from the dock on any floor. Plain figures for money, people, compute, the model,
// the market, projects, accounts and funding; each section's Open button rides to the floor that manages it and opens
// that panel. Read-only: reads FR.state and the sim's own read functions, changes nothing.
(function (FR) {
  const U = FR.ui, O = FR.overview = {};
  const esc = (v) => U.esc(v), km = (n) => U.kmoney(n || 0), ico = (n) => U.icon ? U.icon(n) : '';
  const tryr = (f, d) => { try { const v = f(); return v == null ? d : v; } catch (e) { return d; } };
  const n1 = (v) => (Math.round((+v || 0) * 10) / 10).toFixed(1).replace(/\.0$/, '');
  const pct = (v) => Math.round(+v || 0) + '%';
  const sm = (n) => (n < 0 ? '−' : '+') + km(Math.abs(n));
  const stat = (label, val, sub, cls) => `<div class="stat"><small>${label}</small><b class="num${cls ? ' ' + cls : ''}">${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  // a section: icon, title, one-line summary, figures, and the Open button that goes to the floor that manages it
  function sec(icon, title, line, body, go, tone) {
    return `<section class="ov-sec${tone ? ' ' + tone : ''}"><div class="ov-h">${ico(icon)}<b>${title}</b>`
      + (go ? `<button class="btn small quiet ov-go" data-ov="${esc(go)}" aria-label="Open ${esc(title)}"><span>Open</span>${ico('chevron')}</button>` : '')
      + `</div>${line ? `<p class="ov-line">${line}</p>` : ''}${body || ''}</section>`;
  }
  const runwayText = (w) => w === Infinity || w == null ? 'Positive' : w >= 104 ? '2+ yrs' : Math.max(0, Math.floor(w)) + ' wks';

  O.html = function (s) {
    const f = tryr(() => FR.sim.forecast(s), null), m = s.money, avg = tryr(() => FR.sim.avgCap(s), 0);
    const best = tryr(() => FR.market.best(s), null), rival = best && (s.market.rivals || []).find(r => r.id === best.rivalId);
    const lead = best ? avg - best.avgCap : 0, streak = (s.win && s.win.streak) || 0;
    let out = `<h3>${esc(s.lab.name)}</h3><p class="ov-date">${esc(FR.dateLabel(s.turn))} · company overview</p>`;

    // standing: one sentence on where the lab is in the race
    const stand = !best ? '' : streak > 0 ? `Holding the frontier safely: week <b class="num">${streak}</b> of 52.`
      : lead >= 0 ? `At the frontier on capability, average <b class="num">${n1(avg)}</b>. Safety must be within 5 of capability on every skill to start the 52-week hold.`
        : `Behind ${esc(rival ? rival.name : 'the leader')} by <b class="num">${n1(-lead)}</b> average capability (${n1(avg)} against ${n1(best.avgCap)}).`;
    if (stand) out += `<p class="ov-stand">${stand}</p>`;

    // money
    const rw = f ? f.runway : Infinity, rcls = rw === Infinity ? 'pos' : rw < 6 ? 'neg' : rw < 13 ? 'tone-warn' : '';
    out += sec('coin', 'Money', f ? `Next week: revenue ${km(f.revenue)}, burn ${km(f.burn)}, net <b class="num ${f.net < 0 ? 'neg' : 'pos'}">${sm(f.net)}</b>.` : '',
      `<div class="stats">${stat('Cash', km(m.cash))}${stat('Runway', runwayText(rw), '', rcls)}${stat('Your stake', pct(m.founderPct), 'of ' + km(m.valuation))}</div>`, 'boardroom:boardroom.table');

    // people
    const joining = (s.staff.hiring || []).reduce((t, h) => t + h.n, 0), payroll = tryr(() => FR.money.payroll(s), 0);
    out += sec('users', 'People', `Payroll ${km(payroll)} a week.`,
      `<div class="stats">${stat('Headcount', s.staff.headcount)}${stat('Joining', joining, joining ? 'in the pipeline' : '')}${stat('Per head', km(payroll / Math.max(1, s.staff.headcount)), 'a week')}</div>`, 'boardroom:boardroom.team');

    // compute
    const cap = tryr(() => FR.compute.capacity(s), { total: 0, owned: 0, rented: 0, deals: 0 }), ccost = tryr(() => FR.compute.cost(s), 0);
    out += sec('compute', 'Compute', `Capacity ${n1(cap.total)} PF: owned ${n1(cap.owned)}, rented ${n1(cap.rented)}, deals ${n1(cap.deals)}. Cost ${km(ccost)} a week.`,
      `<div class="ov-alloc">${FR.ALLOCS.map(k => `<div><span>${esc(FR.ALLOC_NAME[k])}</span><i style="--v:${s.sliders[k]}"></i><b class="num">${s.sliders[k]}%</b></div>`).join('')}</div>`, 'boardroom:boardroom.compute');

    // the model
    const lvl = (k) => tryr(() => FR.model.outlook(s, k).level, 'ok');
    const TONE = { ok: 'good', watch: 'warn', warning: 'bad', critical: 'bad' }, LBL = { ok: 'OK', watch: 'Watch', warning: 'Warning', critical: 'Critical' };
    const pr = tryr(() => FR.model.pressureLevel(s), null);
    out += sec('safety', 'Model', `Training ${esc(FR.SKILL_NAME[s.target])}.${pr ? ' ' + esc(pr.text) : ''}`,
      `<div class="ov-skills">${FR.SKILLS.map(k => { const sk = s.model.skills[k], l = lvl(k); return `<div><span>${esc(FR.SKILL_NAME[k])}</span><b class="num">${Math.round(sk.cap)}</b><b class="num ov-safe">${Math.round(sk.safe)}</b><em class="badge ${TONE[l] || ''}">${LBL[l] || l}</em></div>`; }).join('')}`
      + `<p class="ov-key"><b class="num">cap</b> capability · <b class="num ov-safe">safe</b> safety</p></div>`, 'safety:safety.evals', pr && pr.level !== 'ok' ? 'warn' : '');

    // market
    const firsts = (s.market.firsts || []), won = firsts.filter(x => x.by === 'player').length;
    out += sec('rival', 'Market', `Public trust ${n1(s.market.trust)}. Frontier records: ${won} set, ${firsts.length - won} to rivals.`,
      `<div class="stats">${stat('Trust', n1(s.market.trust), 'revenue ×' + n1(tryr(() => FR.money.trustMult(s), 1)))}${stat('Leader', esc(rival ? rival.name : '—'), best ? 'avg ' + n1(best.avgCap) : '')}${stat('You', n1(avg), lead >= 0 ? 'ahead' : 'behind', lead >= 0 ? 'pos' : '')}</div>`, 'boardroom:boardroom.rivals');

    // projects and research
    const act = s.projects.active || [];
    out += sec('research', 'Projects', act.length ? act.map(p => `${esc(p.name)} (${p.turnsLeft} wk${p.turnsLeft === 1 ? '' : 's'} left)`).join(' · ') : 'No project running. The Research floor has the offer board.',
      `<div class="stats">${stat('Running', act.length + ' of ' + s.projects.slots)}${stat('Research tier', s.research.tier)}${stat('Offers', (s.projects.offers || []).length)}</div>`, 'research:research.offers');

    // enterprise accounts (V0.3; shown once the module exists)
    if (s.accounts && FR.accounts) {
      const A = FR.accounts, acts = s.accounts.active || [], unlocked = !!(s.accounts.unlocked || acts.length || (s.accounts.offers || []).length);
      const dbg = tryr(() => A.debug(s), {}), maxA = tryr(() => A.maxActive(s), 4), MK = (A.K && A.K.mood) || { watch: 45, churn: 30 };
      const risk = acts.filter(a => +a.mood < MK.watch), am = dbg.avgMood || 0, moodCls = !acts.length ? '' : am < MK.churn ? 'neg' : am < MK.watch ? 'tone-warn' : '';
      out += sec('serving', 'Accounts', unlocked ? `Contracted ${km(tryr(() => A.contracted(s), dbg.contracted || 0))} a week · backlog ${km(tryr(() => A.backlog(s), 0))}.`
        : 'Enterprise buyers open talks once average capability reaches 20 and public trust is 45 or more.',
        unlocked ? `<div class="stats">${stat('Active', acts.length + ' of ' + maxA)}${stat('Offers', (s.accounts.offers || []).length)}${stat('Avg mood', acts.length ? Math.round(dbg.avgMood || 0) : '—', '', moodCls)}</div>`
          + (risk.length ? `<p class="ov-line tone-warn">${risk.length === 1 ? esc(risk[0].name) + ' is' : risk.length + ' accounts are'} below mood ${MK.watch}; under ${MK.churn} an account leaves the next week.</p>` : '') : '', 'serving:serving.accounts', risk.length ? 'warn' : '');
    }

    // funding
    const ms = m.milestone, offer = m.offer, rn = (r) => tryr(() => FR.money.K.rounds[r].name, r);
    const fund = offer ? `${esc(rn(offer.round))} offer on the table: ${km(offer.amount)} for ${pct(offer.pct * 100)}.`
      : ms ? esc(ms.text || '') : m.lockedUntil > s.turn ? `No round until ${esc(FR.dateLabel(m.lockedUntil))}.` : 'No round scheduled.';
    out += sec('record', 'Funding', fund, `<p class="ov-line">Closed: ${m.roundsDone.length ? m.roundsDone.map(r => esc(rn(r))).join(', ') : 'none yet'}.</p>`, 'boardroom:boardroom.table', offer ? 'gold' : '');
    return out;
  };

  O.open = function () {
    const s = FR.state; if (!s || !U.sheet) return;
    if (FR.elevator && FR.elevator.riding) return;
    U.sheet(`<div class="ov">${O.html(s)}</div>`, 'overview');
  };
  O.refresh = function () { if (U.sheetId === 'overview' && FR.state) { const b = document.getElementById('sheetBody'), top = b ? b.scrollTop : 0; U.sheet(`<div class="ov">${O.html(FR.state)}</div>`, 'overview'); if (b) b.scrollTop = top; } };
  U.overview = O.open;

  function bind() {
    const css = document.createElement('style'); css.id = 'frOverviewCss';
    css.textContent = [
      '.ov .num{white-space:nowrap}.ov h3{margin-bottom:2px}.ov-date{margin:0 0 var(--sp-3);font-size:var(--text-sm);color:var(--ink-3)}',
      '.ov-stand{margin:0 0 var(--sp-3);padding:10px 12px;border-radius:var(--r-md);background:var(--info-tint);font-size:var(--text-md);line-height:var(--lh-snug)}',
      '.ov-sec{margin:0 0 var(--sp-3);padding:var(--sp-3);border:1px solid var(--line);border-radius:var(--r-lg);background:var(--raised)}',
      '.ov-sec.warn{border-color:color-mix(in srgb,var(--warn) 55%,var(--line))}.ov-sec.gold{border-color:color-mix(in srgb,var(--gold) 55%,var(--line))}',
      '.ov-h{display:flex;align-items:center;gap:var(--sp-2);min-height:var(--tap)}.ov-h>.ico{color:var(--ink-2)}.ov-h b{flex:1;font-family:var(--font-display);font-size:var(--text-lg)}',
      '.ov-go{width:auto;flex:none;margin:0;gap:2px;min-height:var(--tap);color:var(--brand-text)}.ov-go .ico{width:16px;height:16px}',
      '.ov-line{margin:0 0 var(--sp-2);font-size:var(--text-sm);line-height:var(--lh-snug);color:var(--ink-2)}',
      '.ov-alloc{display:grid;gap:6px}.ov-alloc div{display:grid;grid-template-columns:80px 1fr 40px;align-items:center;gap:8px;font-size:var(--text-sm)}',
      '.ov-alloc i{display:block;height:8px;border-radius:4px;background:linear-gradient(90deg,var(--brand-bright) calc(var(--v)*1%),var(--sunken) 0)}.ov-alloc b{text-align:right}',
      '.ov-skills{display:grid;gap:6px}.ov-skills>div{display:grid;grid-template-columns:1fr 36px 36px auto;align-items:center;gap:8px;font-size:var(--text-md)}',
      '.ov-skills b{text-align:right;color:var(--brand-text)}.ov-skills .ov-safe,.ov-key .ov-safe{color:var(--good)}.ov-skills .badge{justify-self:end}',
      '.ov-key{grid-template-columns:none!important;margin:2px 0 0;font-size:var(--text-xs);color:var(--ink-3)}.ov-key b{color:var(--brand-text)}'
    ].join('\n');
    document.head.appendChild(css);
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-ov]'); if (!b) return;
      const [floor, hot] = String(b.dataset.ov).split(':');
      U.sheet(null);
      const openPanel = () => { if (U.panel) U.panel(hot); };
      if (U.goFloor) U.goFloor(floor, openPanel); else openPanel();
    });
    FR.on('state:changed', O.refresh); FR.on('turn:ended', O.refresh);
  }
  O.debug = () => ({ open: U.sheetId === 'overview' });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})(window.FR);
