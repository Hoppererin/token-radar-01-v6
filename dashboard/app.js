// Token Radar v6 dashboard — static page, no network, no external files.
// Reads window.RADAR_DATA (written by main.ts) and renders the board, the
// detail view, the live-token view and the Method page.

/**
 * Uncertainty-interval multipliers (DISPLAY constants, not model constants:
 * they never change an implied value or a rank). Source: the v5 model's
 * leave-one-out residuals on its 128 comps — each comp predicted by a model
 * fit from the other 127; residual = ln(actual mcap) - ln(predicted mcap);
 * multiplier = quantile of exp(residual) = actual / predicted. LOO median
 * absolute log error 1.2850; walk-forward median absolute log error 1.0505.
 */
const INTERVAL_MULTIPLIERS = {
  p10: 0.0696,
  p25: 0.2805,
  p50: 1.0478,
  p75: 3.6866,
  p90: 8.4375,
};

const DATA = window.RADAR_DATA;
const ROWS = DATA.rows;
const LEDGER = DATA.ledger;
const META = DATA.meta;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtMoney(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v);
}
function fmtFull(v) {
  return '$' + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function fmtInt(v) {
  return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function fmtPct(v) {
  if (v === null || v === undefined) return '&mdash;';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}
function fmtAge(v) {
  if (v === null || v === undefined) return '&mdash;';
  return v + ' d';
}
function fmtRatio(v) {
  return Number(v.toPrecision(2)).toString();
}
function fmtSigned(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(2);
}
function intervalText(implied) {
  const lo = Math.round(implied * INTERVAL_MULTIPLIERS.p25);
  const hi = Math.round(implied * INTERVAL_MULTIPLIERS.p75);
  return 'P25&ndash;P75: ' + fmtMoney(lo) + ' &ndash; ' + fmtMoney(hi);
}
function chainsShort(chains) {
  if (chains.length <= 2) return esc(chains.join(', '));
  return esc(chains.slice(0, 2).join(', ')) + ' <span class="muted">+' + (chains.length - 2) + '</span>';
}

// ---------------------------------------------------------------- ledger bar
(function renderLedger() {
  const ranked = LEDGER.ranked_watchlist + LEDGER.ranked_above_floor + LEDGER.ranked_below_floor;
  const withToken = LEDGER.token_trades + LEDGER.token_recorded_no_cap;
  const excluded = LEDGER.out_bridge + LEDGER.out_liquid_staking + LEDGER.out_exchange + LEDGER.out_versioned + LEDGER.out_wrapped;
  document.getElementById('ledger-bar').innerHTML =
    '<b>' + LEDGER.total + ' protocols accounted for:</b> ' +
    ranked + ' ranked &middot; ' + withToken + ' with a token &middot; ' + excluded +
    ' excluded &mdash; including all ' + LEDGER.ranked_watchlist + ' watchlist protocols';
})();

// ---------------------------------------------------------------- filters
const state = { search: '', category: '', chain: '', minTvl: 0, watchlist: false, sort: 'rank', dir: 1 };
const SORT_DIR = { rank: 1, name: 1, tvl: -1, implied: -1, growth: -1, age: -1 };

function fillSelect(id, values) {
  const el = document.getElementById(id);
  values.forEach((v) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    el.appendChild(o);
  });
}
fillSelect('f-category', [...new Set(ROWS.map((r) => r.category))].sort());
fillSelect('f-chain', [...new Set(ROWS.flatMap((r) => r.chains))].sort());

function filteredRows() {
  const q = state.search.trim().toLowerCase();
  let out = ROWS.filter((r) => {
    if (state.watchlist && !r.watchlist) return false;
    if (state.category && r.category !== state.category) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (r.tvl_usd < state.minTvl) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q) || (r.category || '').toLowerCase().includes(q))) return false;
    return true;
  });
  const k = state.sort;
  const dir = state.dir;
  out = out.slice().sort((a, b) => {
    let d = 0;
    if (k === 'rank') d = a.rank - b.rank;
    else if (k === 'name') d = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    else if (k === 'tvl') d = a.tvl_usd - b.tvl_usd;
    else if (k === 'implied') d = a.implied_value_usd - b.implied_value_usd;
    else if (k === 'growth') d = (a.change_7d === null ? -Infinity : a.change_7d) - (b.change_7d === null ? -Infinity : b.change_7d);
    else if (k === 'age') d = (a.age_days === null ? -Infinity : a.age_days) - (b.age_days === null ? -Infinity : b.age_days);
    return d * dir || (a.rank - b.rank);
  });
  return out;
}

function renderBoard() {
  const rows = filteredRows();
  document.getElementById('board-count').textContent =
    rows.length + ' of ' + ROWS.length + ' ranked protocols' + (rows.length !== ROWS.length ? ' match the filters' : '');
  const body = document.getElementById('board-body');
  body.innerHTML = rows.map((r) =>
    '<tr data-slug="' + esc(r.slug) + '"' + (r.rank <= 3 ? ' class="top3"' : '') + '>' +
    '<td class="rank num">' + r.rank + '</td>' +
    '<td class="name">' + esc(r.name) + (r.watchlist ? '<span class="tag">WATCHLIST</span>' : '') +
    '<small>' + esc(r.slug) + '</small></td>' +
    '<td>' + esc(r.category || '&mdash;') + '</td>' +
    '<td title="' + esc(r.chains.join(', ')) + '">' + chainsShort(r.chains) + '</td>' +
    '<td class="num">' + fmtMoney(r.tvl_usd) + '</td>' +
    '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
    '<td class="num">' + fmtAge(r.age_days) + '</td>' +
    '<td class="num"><span class="implied">' + fmtMoney(r.implied_value_usd) + '</span>' +
    '<span class="interval">' + intervalText(r.implied_value_usd) + '</span></td>' +
    '<td class="num">' + fmtRatio(r.ratio) + '</td>' +
    '</tr>'
  ).join('');
  body.querySelectorAll('tr').forEach((tr) => tr.addEventListener('click', () => openDetail(tr.dataset.slug)));
}

document.getElementById('f-search').addEventListener('input', (e) => { state.search = e.target.value; renderBoard(); });
document.getElementById('f-category').addEventListener('change', (e) => { state.category = e.target.value; renderBoard(); });
document.getElementById('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
document.getElementById('f-tv').addEventListener('change', (e) => { state.minTvl = Number(e.target.value); renderBoard(); });
document.getElementById('f-watchlist').addEventListener('change', (e) => { state.watchlist = e.target.checked; renderBoard(); });
document.getElementById('f-sort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  state.dir = SORT_DIR[state.sort] || 1;
  renderBoard();
});
document.querySelectorAll('.board thead th[data-sort]').forEach((th) => th.addEventListener('click', () => {
  const k = th.dataset.sort;
  if (state.sort === k) state.dir = -state.dir;
  else { state.sort = k; state.dir = SORT_DIR[k] || 1; }
  document.getElementById('f-sort').value = state.sort;
  renderBoard();
}));

// ---------------------------------------------------------------- detail
function openDetail(slug) {
  const r = ROWS.find((x) => x.slug === slug);
  if (!r) return;
  const p25 = Math.round(r.implied_value_usd * INTERVAL_MULTIPLIERS.p25);
  const p75 = Math.round(r.implied_value_usd * INTERVAL_MULTIPLIERS.p75);
  const p10 = Math.round(r.implied_value_usd * INTERVAL_MULTIPLIERS.p10);
  const p90 = Math.round(r.implied_value_usd * INTERVAL_MULTIPLIERS.p90);
  const notes = [];
  if (r.age_days === null) notes.push('Age unknown: listed_at is missing from the snapshot, so the model uses the training median age.');
  else if (r.age_days < 180) notes.push('Young protocol (' + r.age_days + ' days): recent protocols behave differently, which is why age is a model feature.');
  else notes.push('Running ' + r.age_days + ' days with no token recorded.');
  if (r.change_7d === null) notes.push('No 7-day growth reported; the model reads growth as 0.');
  else if (r.change_7d < -20) notes.push('TVL fell ' + Math.abs(r.change_7d).toFixed(1) + '% in 7 days; falling TVL associates with a higher mcap/TVL in the comps.');
  else notes.push('TVL ' + fmtPct(r.change_7d) + ' over 7 days.');
  if (r.chains.length === 1) notes.push('Single-chain (' + esc(r.chains[0]) + '): concentrated on one chain.');
  else notes.push('On ' + r.chains.length + ' chains: ' + esc(r.chains.join(', ')) + '.');
  if (r.watchlist) notes.push('On the house watchlist (TVL at or above the $50M floor, pre-token).');
  document.getElementById('detail-body').innerHTML =
    '<h2>#' + r.rank + ' &mdash; ' + esc(r.name) + (r.watchlist ? '<span class="tag">WATCHLIST</span>' : '') + '</h2>' +
    '<p class="lede">' + esc(r.category || 'Uncategorised') + ' &middot; ' + esc(r.chains.join(', ')) +
    ' &middot; TVL ' + fmtFull(r.tvl_usd) + ' &middot; snapshot ' + esc(META.as_of) + '</p>' +
    '<div class="grid"><div class="col"><h3>Value build-up</h3>' +
    '<table class="kv"><tbody>' +
    '<tr><td>TVL</td><td>' + fmtFull(r.tvl_usd) + '</td></tr>' +
    '<tr><td>Global curve prediction (ln mcap = ' + META.curve.intercept.toFixed(2) + ' + ' + META.curve.slope.toFixed(2) + ' &times; ln TVL)</td><td>' + fmtFull(r.curve_usd) + '</td></tr>' +
    '<tr><td>Group offset &mdash; ' + esc(r.group) + ' (' + fmtSigned(r.group_offset_log) + ' log points)</td><td>' + fmtFull(r.grouped_usd) + '</td></tr>' +
    '<tr><td>Ridge median adjustment (' + fmtSigned(r.ridge_delta_log) + ' log points)</td><td>' + fmtFull(r.ridge_usd) + '</td></tr>' +
    '<tr class="total"><td>Blended implied value (0.7 grouped + 0.3 ridge)</td><td>' + fmtFull(r.implied_value_usd) + '</td></tr>' +
    '<tr><td>Implied / TVL</td><td>' + fmtRatio(r.ratio) + '</td></tr>' +
    '<tr><td>Uncertainty P25&ndash;P75</td><td>' + fmtMoney(p25) + ' &ndash; ' + fmtMoney(p75) + '</td></tr>' +
    '<tr><td>Uncertainty P10&ndash;P90</td><td>' + fmtMoney(p10) + ' &ndash; ' + fmtMoney(p90) + '</td></tr>' +
    '</tbody></table>' +
    '<p class="note">The implied value is the centre of a wide distribution, not a promise. The interval above is the model&rsquo;s own leave-one-out error range &mdash; see Method.</p>' +
    '</div><div class="col"><h3>Farm plan</h3><ol class="steps">' +
    r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') +
    '</ol><h3>Risk notes</h3><ul class="steps">' +
    notes.map((s) => '<li>' + s + '</li>').join('') +
    '</ul></div></div>';
  document.getElementById('detail').hidden = false;
  document.getElementById('view-board').hidden = true;
}
document.getElementById('detail-close').addEventListener('click', () => {
  document.getElementById('detail').hidden = true;
  document.getElementById('view-board').hidden = false;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* file open */ }
});

// ---------------------------------------------------------------- live view
(function renderLive() {
  document.getElementById('live-body').innerHTML = DATA.live.map((r, i) =>
    '<tr><td class="rank num">' + (i + 1) + '</td>' +
    '<td class="name">' + esc(r.name) + '<small>' + esc(r.slug) + '</small></td>' +
    '<td>' + esc(r.category || '&mdash;') + '</td>' +
    '<td class="num">' + fmtMoney(r.tvl_usd) + '</td>' +
    '<td class="num">' + fmtMoney(r.mcap_usd) + '</td>' +
    '<td class="num">' + fmtRatio(r.mcap_usd / r.tvl_usd) + '</td>' +
    '<td class="num">' + fmtPct(r.change_7d) + '</td></tr>'
  ).join('');
})();

// ---------------------------------------------------------------- coverage table
(function renderCoverage() {
  const rows = [
    ['Token trades', LEDGER.token_trades, 'Has a token and a market cap over $0 (the 128 comps)'],
    ['Token recorded, no usable cap', LEDGER.token_recorded_no_cap, 'Has a token recorded but no market cap over $0'],
    ['Ranked watchlist', LEDGER.ranked_watchlist, 'On the house watchlist, all ranked'],
    ['Ranked off-list above floor', LEDGER.ranked_above_floor, 'Ranked, not on the watchlist, TVL at or above $50,000,000'],
    ['Ranked early below floor', LEDGER.ranked_below_floor, 'Ranked, not on the watchlist, TVL below $50,000,000'],
    ['Out: bridge', LEDGER.out_bridge, 'Pre-token, category Bridge or Canonical Bridge'],
    ['Out: liquid staking', LEDGER.out_liquid_staking, 'Pre-token, category Liquid Staking, Liquid Restaking, Staking Pool or Restaked BTC'],
    ['Out: exchange', LEDGER.out_exchange, 'Pre-token, category CEX'],
    ['Out: versioned', LEDGER.out_versioned, 'Pre-token, name ends in a version marker (V2, V3, 2.0, ...)'],
    ['Out: wrapped / staked / bridged', LEDGER.out_wrapped, 'Pre-token, name marks a wrapped, staked or bridged product'],
  ];
  document.querySelector('#coverage-table tbody').innerHTML = rows.map((r, i) =>
    '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(r[0]) + '</td><td class="num"><b>' + r[1] + '</b></td><td>' + esc(r[2]) + '</td></tr>'
  ).join('');
})();

// ---------------------------------------------------------------- views + deep links
function showView(name) {
  document.getElementById('view-board').hidden = name !== 'board';
  document.getElementById('view-live').hidden = name !== 'live';
  document.getElementById('view-method').hidden = name !== 'method';
  document.getElementById('detail').hidden = true;
  document.getElementById('tab-board').classList.toggle('active', name === 'board');
  document.getElementById('tab-live').classList.toggle('active', name === 'live');
  document.getElementById('tab-method').classList.toggle('active', name === 'method');
}
document.getElementById('tab-board').addEventListener('click', () => showView('board'));
document.getElementById('tab-live').addEventListener('click', () => showView('live'));
document.getElementById('tab-method').addEventListener('click', () => showView('method'));

(function init() {
  renderBoard();
  const q = new URLSearchParams(location.search);
  if (q.get('watchlist') === '1') {
    state.watchlist = true;
    document.getElementById('f-watchlist').checked = true;
    renderBoard();
  }
  const view = q.get('view');
  if (view === 'live' || view === 'method') showView(view);
  const detail = q.get('detail');
  if (detail) {
    openDetail(detail);
    setTimeout(() => {
      const el = document.getElementById('detail');
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 8);
    }, 50);
  }
})();
