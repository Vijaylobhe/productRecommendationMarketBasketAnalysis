// FreshCart basket insights: a local, interactive market basket dashboard.
// Reads window.DASHBOARD_DATA (dashboard/data.js) and draws everything with d3.
(() => {
  const DATA = window.DASHBOARD_DATA;
  const root = document.querySelector('.fc');
  const tip = root.querySelector('.fc-tip');

  if (!DATA || !window.d3) {
    root.replaceChildren(Object.assign(document.createElement('div'), {
      className: 'fc-fail',
      textContent: !window.d3
        ? 'The chart library is missing. Check that dashboard/vendor/d3.v7.9.0.min.js exists.'
        : 'No dashboard data found. Run "python scripts/build_dashboard_data.py" from the project folder, then reload.',
    }));
    return;
  }

  const pct = d3.format('.1%'), pct0 = d3.format('.0%'), num = d3.format(','), money = d3.format('$,.2f'), two = d3.format('.2f');
  const compactMoney = (v) => '$' + new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8', '--series-9'];
  const mk = (tag, text, attrs = {}, cls) => {
    const el = document.createElement(tag);
    if (text != null) el.textContent = text;
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (cls) el.className = cls;
    return el;
  };

  // ---------- data ----------
  const RULES = DATA.rules.map((r) => ({ ...r, a: r.antecedents.split(', '), c: r.consequents.split(', ') }));
  const PRODUCTS = DATA.products;
  const MAX_LIFT = d3.max(RULES, (r) => r.lift);

  // ---------- theme ----------
  const themeBtn = document.getElementById('theme-toggle');
  const store = {
    get: () => { try { return localStorage.getItem('fc-theme'); } catch { return null; } },
    set: (v) => { try { localStorage.setItem('fc-theme', v); } catch { /* storage unavailable */ } },
  };
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light')) === 'dark';
  const syncThemeBtn = () => { themeBtn.textContent = isDark() ? 'Light theme' : 'Dark theme'; };
  if (store.get()) document.documentElement.dataset.theme = store.get();
  themeBtn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set(next);
    syncThemeBtn();
    draw();
  });
  systemDark.addEventListener('change', () => { syncThemeBtn(); draw(); });
  syncThemeBtn();

  // ---------- shared helpers ----------
  function showTip(event, head, lines) {
    tip.replaceChildren(mk('div', head, {}, 'fc-tip-head'), ...lines.map((l) => mk('div', l)));
    tip.hidden = false;
    const b = root.getBoundingClientRect();
    let x = event.clientX - b.left + 14;
    const y = event.clientY - b.top + 14;
    if (x + tip.offsetWidth > b.width) x = Math.max(0, event.clientX - b.left - tip.offsetWidth - 14);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  function svgIn(box, W, H) {
    box.replaceChildren();
    return d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`);
  }
  function textW(svg, strs) {
    const t = svg.append('text').style('font-size', 'var(--fs-caption)');
    let w = 0;
    for (const s of strs) { t.text(s); w = Math.max(w, t.node().getComputedTextLength()); }
    t.remove();
    return w;
  }
  function styleAxis(g) {
    g.attr('font-size', null).attr('font-family', null);
    g.selectAll('text').style('fill', 'var(--fg-muted)').style('font-size', 'var(--fs-caption)');
    g.selectAll('line').style('stroke', 'var(--axis)');
    g.select('.domain').style('stroke', 'var(--axis)');
  }

  // ---------- tabs ----------
  const TABS = ['rules-explorer', 'recommender', 'network', 'patterns'];
  const hash = location.hash.slice(1);
  let tab = TABS.includes(hash) ? hash : 'rules-explorer';
  const tabBtns = root.querySelectorAll('.fc-tab');
  function showTab(t, link) {
    tab = t;
    tabBtns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    TABS.forEach((id) => { document.getElementById('panel-' + id).hidden = id !== t; });
    hideTip();
    if (link) history.replaceState(null, '', '#' + t);
    draw();
  }
  tabBtns.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab, true)));

  // ---------- header ----------
  function drawHeader() {
    const k = DATA.kpis;
    root.querySelectorAll('[data-kpi]').forEach((el) => {
      const f = el.dataset.kpi;
      if (f === 'rules') { el.textContent = num(RULES.length); return; }
      const v = Number(k[f]);
      el.textContent = f === 'revenue' ? compactMoney(v)
        : f === 'avg_order_value' ? money(v)
        : f === 'pct_single_item_baskets' ? v.toFixed(1) + '%'
        : f === 'avg_items_per_basket' ? two(v) : num(v);
    });
    const top = RULES.filter((r) => r.rule_size === 2).sort((a, b) => b.lift - a.lift || b.confidence - a.confidence)[0];
    const take = document.getElementById('takeaway');
    if (!top) { take.textContent = ''; return; }
    take.replaceChildren(
      'The strongest link is ', mk('b', top.antecedents), ' → ', mk('b', top.consequents),
      `: ${pct(top.confidence)} of baskets with the first also hold the second, ${two(top.lift)}× the usual rate. `
      + 'Meal kits like pasta, taco and burger night make up most of the strongest rules, so they are the best place to start with bundles and placement.'
    );
    document.getElementById('footer').textContent =
      `Synthetic FreshCart data for 2025: ${num(k.transactions)} baskets, ${num(k.products)} products. `
      + `Rules mined with Apriori (minimum support 1%). Data file built ${DATA.generated}. Runs entirely on this computer.`;
  }

  // ---------- rule explorer ----------
  const st = { minLift: 1.2, minConf: 0.25, size: 'all', q: '', sel: null, sort: 'lift', dir: -1 };
  const fLift = document.getElementById('f-lift'), fConf = document.getElementById('f-conf');
  const fSize = document.getElementById('f-size'), fQ = document.getElementById('f-q');
  fLift.addEventListener('input', () => { st.minLift = +fLift.value; document.getElementById('o-lift').textContent = (+fLift.value).toFixed(1); drawRules(); });
  fConf.addEventListener('input', () => { st.minConf = +fConf.value; document.getElementById('o-conf').textContent = pct0(+fConf.value); drawRules(); });
  fSize.addEventListener('change', () => { st.size = fSize.value; drawRules(); });
  fQ.addEventListener('input', () => { st.q = fQ.value; drawRules(); });
  root.querySelectorAll('#rule-table th button').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.sort;
    st.dir = st.sort === key ? -st.dir : (['antecedents', 'consequents', 'rank'].includes(key) ? 1 : -1);
    st.sort = key;
    drawTable();
  }));
  document.querySelector('#rule-table tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-key]');
    if (!tr) return;
    st.sel = st.sel === +tr.dataset.key ? null : +tr.dataset.key;
    drawRules(false);
  });
  document.getElementById('download-rules').addEventListener('click', () => {
    const cols = ['rank', 'antecedents', 'consequents', 'rule_size', 'support', 'confidence', 'lift', 'baskets'];
    const quote = (v) => (typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [cols.join(','), ...sortedFiltered().map((r) => cols.map((c) => quote(r[c])).join(','))].join('\n');
    const a = mk('a', null, { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'association_rules_filtered.csv' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  function filtered() {
    const q = st.q.trim().toLowerCase();
    return RULES.filter((r) => r.lift >= st.minLift && r.confidence >= st.minConf
      && (st.size === 'all' || (st.size === '4' ? r.rule_size >= 4 : r.rule_size === +st.size))
      && (!q || (r.antecedents + ' ' + r.consequents).toLowerCase().includes(q)));
  }
  function sortedFiltered() {
    const F = filtered();
    const cmp = typeof RULES[0][st.sort] === 'string'
      ? (a, b) => st.dir * a[st.sort].localeCompare(b[st.sort])
      : (a, b) => st.dir * (a[st.sort] - b[st.sort]) || a.rank - b.rank;
    return F.sort(cmp);
  }

  function drawRules(scrollToSel) {
    drawScatter();
    drawTable(scrollToSel);
  }

  function drawScatter() {
    const box = document.getElementById('rule-scatter');
    const shown = new Set(filtered().map((r) => r.rank));
    const W = box.clientWidth, H = Math.round(Math.max(260, Math.min(380, W * 0.5)));
    const svg = svgIn(box, W, H);
    const x = d3.scaleLinear([0, d3.max(RULES, (r) => r.support)], [0, 1]).nice();
    const y = d3.scaleLinear([0.2, 1], [0, 1]);
    const yTicks = y.ticks(5);
    const m = { t: 10, r: 14, b: 44, l: Math.ceil(textW(svg, yTicks.map(pct0))) + 30 };
    x.range([m.l, W - m.r]);
    y.range([H - m.b, m.t]);
    const rad = d3.scaleSqrt([1, MAX_LIFT], [2.5, 10]);
    const ramp = d3.interpolateRgb(css('--chart-muted'), css('--series-1'));
    const col = (l) => ramp(Math.min(1, (l - 1) / (MAX_LIFT - 1)));

    svg.append('g').selectAll('line').data(yTicks).join('line')
      .attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).style('stroke', 'var(--grid)');
    const gx = svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(Math.max(2, Math.floor((W - m.l) / 90))).tickFormat(pct0).tickSizeOuter(0));
    const gy = svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues(yTicks).tickFormat(pct0).tickSize(0).tickPadding(8));
    gy.select('.domain').remove();
    styleAxis(gx); styleAxis(gy);
    svg.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 6).attr('text-anchor', 'middle')
      .style('fill', 'var(--fg-muted)').style('font-size', 'var(--fs-caption)').text('Support: share of all baskets');
    svg.append('text').attr('transform', `translate(12,${(m.t + H - m.b) / 2}) rotate(-90)`).attr('text-anchor', 'middle')
      .style('fill', 'var(--fg-muted)').style('font-size', 'var(--fs-caption)').text('Confidence');

    const ordered = [...RULES].sort((a, b) => (shown.has(a.rank) - shown.has(b.rank)) || (a.rank === st.sel) - (b.rank === st.sel) || a.lift - b.lift);
    svg.append('g').selectAll('circle').data(ordered).join('circle')
      .attr('cx', (r) => x(r.support)).attr('cy', (r) => y(r.confidence)).attr('r', (r) => rad(r.lift))
      .style('fill', (r) => (shown.has(r.rank) ? col(r.lift) : 'var(--chart-muted)'))
      .style('fill-opacity', (r) => (shown.has(r.rank) ? 0.85 : 0.18))
      .style('stroke', (r) => (r.rank === st.sel ? 'var(--fg)' : 'var(--panel)'))
      .style('stroke-width', (r) => (r.rank === st.sel ? 2.5 : 0.75))
      .style('cursor', 'pointer')
      .on('mousemove', (e, r) => showTip(e, `${r.antecedents} → ${r.consequents}`, [
        `Support ${pct(r.support)} (${num(r.baskets)} baskets)`, `Confidence ${pct(r.confidence)}`, `Lift ${two(r.lift)}`, `Rank ${r.rank}`]))
      .on('mouseleave', hideTip)
      .on('click', (e, r) => { st.sel = r.rank; drawRules(true); });
  }

  function drawTable(scrollToSel) {
    const tbody = document.querySelector('#rule-table tbody');
    const count = document.getElementById('rule-count');
    root.querySelectorAll('#rule-table th').forEach((th) => {
      if (th.dataset.field === st.sort) th.setAttribute('aria-sort', st.dir > 0 ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
    const F = sortedFiltered();
    count.textContent = F.length
      ? `Showing ${num(F.length)} of ${num(RULES.length)} rules. Click a row to highlight it in the chart.`
      : 'No rules match these filters. Lower the minimum lift or confidence.';
    let selRow = null;
    tbody.replaceChildren(...F.map((r) => {
      const tr = mk('tr', null, { 'data-key': String(r.rank) }, r.rank === st.sel ? 'is-sel' : '');
      const liftCell = mk('td', null, {}, 'num');
      const bar = mk('span', null, {}, 'fc-bar');
      const i = mk('i');
      i.style.width = (r.lift / MAX_LIFT) * 3.5 + 'rem';
      bar.append(i, mk('span', two(r.lift)));
      liftCell.append(bar);
      tr.append(mk('td', String(r.rank), {}, 'num'), mk('td', r.antecedents), mk('td', r.consequents),
        mk('td', pct(r.support), {}, 'num'), mk('td', pct(r.confidence), {}, 'num'), liftCell, mk('td', num(r.baskets), {}, 'num'));
      if (r.rank === st.sel) selRow = tr;
      return tr;
    }));
    if (scrollToSel && selRow) selRow.scrollIntoView({ block: 'nearest' });
  }

  // ---------- recommender ----------
  let basket = new Set(['Spaghetti']);
  root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    basket = new Set(b.dataset.preset ? b.dataset.preset.split('|') : []);
    drawRecs();
  }));
  document.getElementById('chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.fc-chip');
    if (!chip) return;
    const name = chip.dataset.name;
    if (basket.has(name)) basket.delete(name); else basket.add(name);
    drawRecs();
  });

  function recommend(k = 6) {
    const hits = RULES.filter((r) => r.a.every((p) => basket.has(p)) && !r.c.some((p) => basket.has(p)))
      .sort((a, b) => b.lift - a.lift || b.confidence - a.confidence);
    const seen = new Set(), out = [];
    for (const h of hits) {
      if (seen.has(h.consequents)) continue;
      seen.add(h.consequents);
      out.push(h);
      if (out.length === k) break;
    }
    return out;
  }

  function drawRecs() {
    const chips = document.getElementById('chips');
    const groups = d3.groups([...PRODUCTS].sort((a, b) => b.transactions - a.transactions), (p) => p.category)
      .sort((a, b) => a[0].localeCompare(b[0]));
    chips.replaceChildren(...groups.map(([cat, items]) => {
      const g = mk('div', null, {}, 'fc-chipgroup');
      g.append(mk('span', cat, {}, 'fc-cat'), ...items.map((p) => mk('button', p.product_name,
        { type: 'button', 'data-name': p.product_name, 'aria-pressed': String(basket.has(p.product_name)) }, 'fc-chip')));
      return g;
    }));

    const recs = document.getElementById('recs');
    document.getElementById('recs-basket').textContent = basket.size ? 'Basket: ' + [...basket].join(', ') : 'The basket is empty.';
    if (!basket.size) { recs.replaceChildren(mk('div', 'Pick a product above, or try one of the example baskets.', {}, 'fc-empty')); return; }
    const out = recommend();
    if (!out.length) { recs.replaceChildren(mk('div', 'No strong rule starts from this basket. Add another product, or try an example basket.', {}, 'fc-empty')); return; }
    recs.replaceChildren(...out.map((r) => {
      const card = mk('div', null, {}, 'fc-rec');
      const why = mk('div', null, {}, 'fc-rec-why');
      why.append('In baskets with ', r.antecedents, ', ', mk('b', pct(r.confidence)), ' also had this.');
      const foot = mk('div', null, {}, 'fc-rec-foot');
      const add = mk('button', 'Add to basket', { type: 'button' }, 'fc-btn');
      add.addEventListener('click', () => { r.c.forEach((p) => basket.add(p)); drawRecs(); });
      foot.append(mk('span', `${two(r.lift)}× the usual rate`, {}, 'fc-lift'), add);
      card.append(mk('div', r.consequents, {}, 'fc-rec-name'), why, foot);
      return card;
    }));
  }

  // ---------- network ----------
  let netLift = 3;
  const fNet = document.getElementById('f-net');
  fNet.addEventListener('input', () => { netLift = +fNet.value; document.getElementById('o-net').textContent = netLift.toFixed(1); drawNetwork(); });

  function drawNetwork() {
    const box = document.getElementById('net');
    const legend = document.getElementById('net-legend');
    const pInfo = new Map(PRODUCTS.map((p) => [p.product_name, p]));
    const cats = [...new Set(PRODUCTS.map((p) => p.category))].sort();
    const catColor = new Map(cats.map((c, i) => [c, `var(${SERIES[i % SERIES.length]})`]));

    const best = new Map();
    for (const r of RULES) {
      if (r.rule_size !== 2 || r.lift < netLift) continue;
      const key = [r.antecedents, r.consequents].sort().join('|');
      if (!best.has(key) || best.get(key).confidence < r.confidence) best.set(key, r);
    }
    const links = [...best.values()].map((r) => ({ source: r.antecedents, target: r.consequents, lift: r.lift }));
    const ids = [...new Set(links.flatMap((l) => [l.source, l.target]))];
    if (!ids.length) {
      box.replaceChildren(mk('div', 'No pairs reach this lift. Lower the threshold.', {}, 'fc-empty'));
      legend.replaceChildren();
      return;
    }
    const nodes = ids.map((id) => ({ id, ...pInfo.get(id) }));
    const W = box.clientWidth, H = W < 640 ? 460 : 560;
    const rad = d3.scaleSqrt([0, d3.max(PRODUCTS, (p) => p.support)], [4, 22]);
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => d.id).distance((l) => 28 + 150 / l.lift).strength(0.8))
      .force('charge', d3.forceManyBody().strength(-170))
      .force('collide', d3.forceCollide((d) => rad(d.support) + 16))
      .force('x', d3.forceX(W / 2).strength(0.07))
      .force('y', d3.forceY(H / 2).strength(0.1))
      .stop();
    for (let i = 0; i < 320; i++) sim.tick();
    const pad = 30;
    nodes.forEach((n) => { n.x = Math.max(pad, Math.min(W - pad, n.x)); n.y = Math.max(pad, Math.min(H - pad - 14, n.y)); });

    const svg = svgIn(box, W, H);
    const width = d3.scaleLinear([1, d3.max(links, (l) => l.lift)], [1, 6]);
    const lg = svg.append('g').selectAll('line').data(links).join('line')
      .attr('x1', (l) => l.source.x).attr('y1', (l) => l.source.y).attr('x2', (l) => l.target.x).attr('y2', (l) => l.target.y)
      .style('stroke', 'var(--chart-muted)').style('stroke-opacity', 0.7).style('stroke-width', (l) => width(l.lift)).style('stroke-linecap', 'round');
    const ng = svg.append('g').selectAll('g').data(nodes).join('g')
      .attr('transform', (n) => `translate(${n.x},${n.y})`).style('cursor', 'pointer');
    ng.append('circle').attr('r', (n) => rad(n.support))
      .style('fill', (n) => catColor.get(n.category)).style('stroke', 'var(--panel)').style('stroke-width', 1.5);
    ng.append('text').attr('y', (n) => rad(n.support) + 12).attr('text-anchor', 'middle')
      .style('font-size', 'var(--fs-caption)').style('fill', 'var(--fg)')
      .style('paint-order', 'stroke').style('stroke', 'var(--panel)').style('stroke-width', 3).style('stroke-linejoin', 'round')
      .text((n) => n.id);

    const touches = (l, id) => l.source.id === id || l.target.id === id;
    ng.on('mousemove', (e, n) => {
      const mine = links.filter((l) => touches(l, n.id));
      const set = new Set(mine.flatMap((l) => [l.source.id, l.target.id]));
      ng.style('opacity', (d) => (set.has(d.id) ? 1 : 0.2));
      lg.style('stroke', (l) => (touches(l, n.id) ? catColor.get(n.category) : 'var(--chart-muted)'))
        .style('stroke-opacity', (l) => (touches(l, n.id) ? 0.9 : 0.15));
      const partners = mine.map((l) => ({ name: l.source.id === n.id ? l.target.id : l.source.id, lift: l.lift }))
        .sort((a, b) => b.lift - a.lift).slice(0, 4);
      showTip(e, n.id, [`${n.category} · in ${pct(n.support)} of baskets`, ...partners.map((p) => `With ${p.name}: lift ${two(p.lift)}`)]);
    }).on('mouseleave', () => {
      ng.style('opacity', 1);
      lg.style('stroke', 'var(--chart-muted)').style('stroke-opacity', 0.7);
      hideTip();
    }).on('click', (e, n) => { basket = new Set([n.id]); showTab('recommender', true); });

    legend.replaceChildren(...cats.filter((c) => nodes.some((n) => n.category === c)).map((c) => {
      const s = mk('span');
      const i = mk('i');
      i.style.background = catColor.get(c);
      s.append(i, c);
      return s;
    }));
  }

  // ---------- patterns ----------
  function vbars(box, data, { label, value, fmt, tip: tipLines, xTitle }) {
    const W = box.clientWidth, H = 260;
    const svg = svgIn(box, W, H);
    const y = d3.scaleLinear([0, d3.max(data, value)], [0, 1]).nice();
    const ticks = y.ticks(4);
    const m = { t: 10, r: 6, b: xTitle ? 42 : 26, l: Math.ceil(textW(svg, ticks.map(fmt))) + 12 };
    y.range([H - m.b, m.t]);
    const x = d3.scaleBand(data.map(label), [m.l, W - m.r]).padding(0.25);
    svg.append('g').selectAll('line').data(ticks).join('line')
      .attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).style('stroke', 'var(--grid)');
    const every = Math.ceil(data.length / Math.max(1, Math.floor((W - m.l) / 34)));
    const gx = svg.append('g').attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickValues(data.map(label).filter((_, i) => i % every === 0)).tickSize(0).tickPadding(6));
    const gy = svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues(ticks).tickFormat(fmt).tickSize(0).tickPadding(8));
    gy.select('.domain').remove();
    styleAxis(gx); styleAxis(gy);
    if (xTitle) svg.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 4).attr('text-anchor', 'middle')
      .style('fill', 'var(--fg-muted)').style('font-size', 'var(--fs-caption)').text(xTitle);
    const bw = Math.min(32, x.bandwidth());
    svg.append('g').selectAll('rect').data(data).join('rect')
      .attr('x', (d) => x(label(d)) + (x.bandwidth() - bw) / 2).attr('width', bw)
      .attr('y', (d) => y(value(d))).attr('height', (d) => y(0) - y(value(d))).attr('rx', 4)
      .style('fill', 'var(--series-1)')
      .on('mousemove', function (e, d) { d3.select(this).style('fill-opacity', 0.75); const [h, ...rest] = tipLines(d); showTip(e, h, rest); })
      .on('mouseleave', function () { d3.select(this).style('fill-opacity', 1); hideTip(); });
  }

  function hbars(box, data, { label, value, end, tip: tipLines }) {
    const W = box.clientWidth;
    const row = 26, H = data.length * row + 8;
    const svg = svgIn(box, W, H);
    const lw = Math.ceil(textW(svg, data.map(label))) + 10;
    const ew = Math.ceil(textW(svg, data.map(end))) + 10;
    const x = d3.scaleLinear([0, d3.max(data, value)], [lw, Math.max(lw + 20, W - ew)]);
    const g = svg.append('g').selectAll('g').data(data).join('g').attr('transform', (d, i) => `translate(0,${i * row + 4})`);
    g.append('text').attr('x', lw - 10).attr('y', row / 2).attr('dy', '0.35em').attr('text-anchor', 'end')
      .style('fill', 'var(--fg)').style('font-size', 'var(--fs-caption)').text(label);
    g.append('rect').attr('x', lw).attr('y', 5).attr('height', row - 10).attr('rx', 4)
      .attr('width', (d) => Math.max(1, x(value(d)) - lw)).style('fill', 'var(--series-1)');
    g.append('text').attr('x', (d) => x(value(d)) + 6).attr('y', row / 2).attr('dy', '0.35em')
      .style('fill', 'var(--fg-muted)').style('font-size', 'var(--fs-caption)').style('font-variant-numeric', 'tabular-nums').text(end);
    g.on('mousemove', (e, d) => { const [h, ...rest] = tipLines(d); showTip(e, h, rest); }).on('mouseleave', hideTip);
  }

  function drawPatterns() {
    const parse = d3.utcParse('%Y-%m'), mon = d3.utcFormat('%b');
    const monthly = DATA.monthly.map((r) => ({ month: r.month, label: mon(parse(r.month)), n: r.transactions, rev: r.revenue, aov: r.avg_order_value }));
    vbars(document.getElementById('monthly'), monthly, { label: (d) => d.label, value: (d) => d.n, fmt: num,
      tip: (d) => [d3.utcFormat('%B %Y')(parse(d.month)), `${num(d.n)} baskets`, `Revenue ${money(d.rev)}`, `Average order ${money(d.aov)}`] });

    const sizes = DATA.basketSizes.map((r) => ({ k: String(r.distinct_items), n: r.transactions, share: r.pct_of_transactions, v: r.avg_basket_value }));
    vbars(document.getElementById('sizes'), sizes, { label: (d) => d.k, value: (d) => d.n, fmt: num, xTitle: 'Distinct products in basket',
      tip: (d) => [`${d.k} product${d.k === '1' ? '' : 's'}`, `${num(d.n)} baskets (${d.share.toFixed(1)}%)`, `Average basket ${money(d.v)}`] });

    const heat = document.getElementById('heat');
    const raw = DATA.weekdayHour.map((r) => ({ day: r.weekday, dn: r.weekday_num, h: r.hour, n: r.transactions }));
    const days = [1, 2, 3, 4, 5, 6, 0].map((dn) => raw.find((r) => r.dn === dn)?.day).filter(Boolean);
    const hours = [...new Set(raw.map((r) => r.h))].sort((a, b) => a - b);
    const W = heat.clientWidth, H = days.length * 30 + 30;
    const svg = svgIn(heat, W, H);
    const m = { t: 4, r: 4, b: 24, l: Math.ceil(textW(svg, days)) + 10 };
    const x = d3.scaleBand(hours, [m.l, W - m.r]).padding(0.08);
    const y = d3.scaleBand(days, [m.t, H - m.b]).padding(0.08);
    const ramp = d3.interpolateRgb(css('--grid'), css('--series-1'));
    const [lo, hi] = d3.extent(raw, (r) => r.n);
    svg.append('g').selectAll('rect').data(raw).join('rect')
      .attr('x', (r) => x(r.h)).attr('y', (r) => y(r.day)).attr('width', x.bandwidth()).attr('height', y.bandwidth()).attr('rx', 3)
      .style('fill', (r) => ramp((r.n - lo) / (hi - lo || 1)))
      .on('mousemove', (e, r) => showTip(e, `${r.day} ${String(r.h).padStart(2, '0')}:00–${String(r.h + 1).padStart(2, '0')}:00`, [`${num(r.n)} baskets`]))
      .on('mouseleave', hideTip);
    const every = Math.ceil(hours.length / Math.max(1, Math.floor((W - m.l) / 46)));
    const gx = svg.append('g').attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickValues(hours.filter((_, i) => i % every === 0)).tickFormat((h) => String(h).padStart(2, '0') + ':00').tickSize(0).tickPadding(6));
    const gy = svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickSize(0).tickPadding(6));
    gx.select('.domain').remove(); gy.select('.domain').remove();
    styleAxis(gx); styleAxis(gy);

    const cats = DATA.categories.map((r) => ({ c: r.category, rev: r.revenue, share: r.pct_of_revenue, baskets: r.pct_of_baskets }))
      .sort((a, b) => b.rev - a.rev);
    hbars(document.getElementById('cats'), cats, { label: (d) => d.c, value: (d) => d.rev, end: (d) => `${compactMoney(d.rev)} · ${d.share.toFixed(1)}%`,
      tip: (d) => [d.c, `Revenue ${money(d.rev)}`, `${d.share.toFixed(1)}% of revenue`, `In ${d.baskets.toFixed(1)}% of baskets`] });

    const prods = [...PRODUCTS].sort((a, b) => b.transactions - a.transactions).slice(0, 12);
    hbars(document.getElementById('prods'), prods, { label: (d) => d.product_name, value: (d) => d.support, end: (d) => pct(d.support),
      tip: (d) => [d.product_name, d.category, `In ${num(d.transactions)} baskets (${pct(d.support)})`, `Revenue ${money(d.revenue)}`] });
  }

  // ---------- draw ----------
  function draw() {
    drawHeader();
    if (tab === 'rules-explorer') drawRules();
    else if (tab === 'recommender') drawRecs();
    else if (tab === 'network') drawNetwork();
    else drawPatterns();
  }
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 150); });
  showTab(tab, false);
})();
