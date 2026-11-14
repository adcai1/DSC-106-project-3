// Two Futures, One Planet: CMIP6 interactive map (D3 only)
const SCEN = ['ssp126', 'ssp245', 'ssp585'];
const SCEN_NAME = { ssp126: 'SSP1-2.6', ssp245: 'SSP2-4.5', ssp585: 'SSP5-8.5' };
const SCEN_COLOR = { ssp126: '#173c66', ssp245: '#f79420', ssp585: '#951b1e' };
const MEASURE = {
  tas: {
    name: 'Warming', unit: '°C', fmt: d3.format('+.1f'),
    color: d3.scaleDiverging([-4, 0, 12], t => d3.interpolateRdBu(1 - t)).clamp(true),
    legendTicks: [-4, 0, 4, 8, 12],
  },
  pr: {
    name: 'Precipitation change', unit: '%', fmt: d3.format('+.0f'),
    color: d3.scaleDiverging([-60, 0, 60], d3.interpolateBrBG).clamp(true),
    legendTicks: [-60, -30, 0, 30, 60],
  },
};

const state = { measure: 'tas', scen: 'ssp585', decadeIdx: 24, selected: null, playing: null };
let data, cells, cellPaths;

const W = 960, H = 470;
const projection = d3.geoEqualEarth().fitExtent([[4, 4], [W - 4, H - 4]], { type: 'Sphere' });
const path = d3.geoPath(projection);
const svg = d3.select('#map').attr('viewBox', [0, 0, W, H]);
const tooltip = d3.select('#tooltip');

Promise.all([
  d3.json('cmip6_grid.json'),
  d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json'),
]).then(([grid, world]) => {
  data = grid;
  const nLon = grid.lons.length;
  // One polygon per 5 degree cell. Rings run clockwise so d3-geo treats them as the small cell.
  cells = [];
  grid.lats.forEach((lat, i) => grid.lons.forEach((lon0, j) => {
    const lon = lon0 > 180 ? lon0 - 360 : lon0;
    const x0 = lon - 2.5, x1 = lon + 2.5, y0 = lat - 2.5, y1 = lat + 2.5;
    cells.push({
      idx: i * nLon + j, lat, lon,
      geo: { type: 'Polygon', coordinates: [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]] },
    });
  }));

  svg.append('path').attr('class', 'sphere').attr('d', path({ type: 'Sphere' }));
  cellPaths = svg.append('g').selectAll('path').data(cells).join('path')
    .attr('class', 'cell')
    .attr('d', d => path(d.geo))
    .on('mousemove', showTooltip)
    .on('mouseleave', () => tooltip.attr('hidden', true))
    .on('click', (e, d) => { state.selected = d; update(); });
  svg.append('path').attr('class', 'land')
    .attr('d', path(topojson.feature(world, world.objects.land)));

  d3.select('#decade').attr('max', grid.decades.length - 1).property('value', state.decadeIdx);
  d3.select('#subtitle').text(
    `${grid.model} (${grid.member}), CMIP6 Amon. Annual means regridded to 5° cells, averaged by decade, ` +
    `shown as change from the ${grid.baseline} mean. Precipitation change clipped at ±100%.`);

  // Default selection: a high Arctic cell so the chart is never empty on first load
  state.selected = cells.find(c => c.lat === 77.5 && c.lon === 47.5) || cells[0];
  wireControls();
  update();
}).catch(err => {
  d3.select('#subtitle').text('Could not load data: ' + err.message);
  console.error(err);
});

function value(measure, scen, decadeIdx, cellIdx) {
  const v = data.measures[measure][scen][decadeIdx][cellIdx];
  return v == null ? NaN : v;
}

function update() {
  const m = MEASURE[state.measure];
  cellPaths
    .attr('fill', d => {
      const v = value(state.measure, state.scen, state.decadeIdx, d.idx);
      return Number.isNaN(v) ? '#eee' : m.color(v);
    })
    .attr('stroke', function () { return this.getAttribute('fill'); })   // hides antialiasing seams
    .classed('selected', d => state.selected && d.idx === state.selected.idx);
  cellPaths.filter('.selected').raise();

  d3.select('#decade-label').text(data.decades[state.decadeIdx] + 's');
  d3.selectAll('#scenario-group button').classed('active', function () { return this.dataset.scen === state.scen; });
  d3.selectAll('#measure-group button').classed('active', function () { return this.dataset.measure === state.measure; });
  drawLegend();
  drawChart();
}

function drawLegend() {
  const m = MEASURE[state.measure];
  const lw = 300, lh = 10;
  const x = d3.scaleLinear().domain(d3.extent(m.color.domain())).range([0, lw]);
  const root = d3.select('#legend').selectAll('svg').data([0]).join('svg')
    .attr('viewBox', [0, 0, lw + 40, 40]).attr('width', lw + 40);
  const id = 'legend-grad';
  const grad = root.selectAll('defs').data([0]).join('defs')
    .selectAll('linearGradient').data([0]).join('linearGradient').attr('id', id);
  grad.selectAll('stop').data(d3.range(0, 1.01, 0.1)).join('stop')
    .attr('offset', t => t)
    .attr('stop-color', t => m.color(x.invert(t * lw)));
  root.selectAll('rect').data([0]).join('rect')
    .attr('x', 20).attr('y', 4).attr('width', lw).attr('height', lh).attr('fill', `url(#${id})`);
  root.selectAll('g.ax').data([0]).join('g').attr('class', 'ax')
    .attr('transform', `translate(20,${4 + lh})`)
    .call(d3.axisBottom(x).tickValues(m.legendTicks).tickSize(4).tickFormat(v => m.fmt(v) + m.unit))
    .call(g => g.select('.domain').remove());
}

function drawChart() {
  const m = MEASURE[state.measure];
  const c = state.selected;
  const cw = 400, ch = 300, mg = { t: 12, r: 100, b: 28, l: 44 };
  const chart = d3.select('#chart').attr('viewBox', [0, 0, cw, ch]);
  d3.select('#detail-title').text(`${m.name} at ${place(c)}`);
  d3.select('#detail-sub').text('Solid: this cell. Dashed: global mean. Decadal means vs 1850-1900.');

  const series = SCEN.map(s => ({
    s,
    local: data.decades.map((d, i) => ({ d, v: value(state.measure, s, i, c.idx) })),
    global: data.decades.map((d, i) => ({ d, v: data.global[state.measure][s][i] })),
  }));
  const all = series.flatMap(x => [...x.local, ...x.global]).map(p => p.v).filter(v => !Number.isNaN(v));
  const x = d3.scaleLinear().domain(d3.extent(data.decades)).range([mg.l, cw - mg.r]);
  const y = d3.scaleLinear().domain(d3.extent([0, ...all])).nice().range([ch - mg.b, mg.t]);
  const line = d3.line().defined(p => !Number.isNaN(p.v)).x(p => x(p.d)).y(p => y(p.v));

  chart.selectAll('g.xa').data([0]).join('g').attr('class', 'axis xa')
    .attr('transform', `translate(0,${ch - mg.b})`).call(d3.axisBottom(x).ticks(6, 'd'));
  chart.selectAll('g.ya').data([0]).join('g').attr('class', 'axis ya')
    .attr('transform', `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(6).tickFormat(v => m.fmt(v) + m.unit));
  chart.selectAll('line.zero').data([0]).join('line').attr('class', 'zero')
    .attr('x1', mg.l).attr('x2', cw - mg.r).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', '#bbb');
  chart.selectAll('line.now').data([0]).join('line').attr('class', 'now')
    .attr('x1', x(data.decades[state.decadeIdx])).attr('x2', x(data.decades[state.decadeIdx]))
    .attr('y1', mg.t).attr('y2', ch - mg.b);

  chart.selectAll('path.global').data(series, d => d.s).join('path').attr('class', 'global')
    .attr('fill', 'none').attr('stroke', d => SCEN_COLOR[d.s]).attr('stroke-width', 1.2)
    .attr('stroke-dasharray', '4 3').attr('opacity', d => d.s === state.scen ? 0.9 : 0.35)
    .attr('d', d => line(d.global));
  chart.selectAll('path.local').data(series, d => d.s).join('path').attr('class', 'local')
    .attr('fill', 'none').attr('stroke', d => SCEN_COLOR[d.s])
    .attr('stroke-width', d => d.s === state.scen ? 3 : 1.6)
    .attr('opacity', d => d.s === state.scen ? 1 : 0.55)
    .attr('d', d => line(d.local));

  // Direct labels at line ends, nudged apart so they never overlap
  const ends = series.map(d => ({ s: d.s, v: d.local[d.local.length - 1].v }))
    .filter(e => !Number.isNaN(e.v)).sort((a, b) => b.v - a.v);
  let lastY = -Infinity;
  ends.forEach(e => { e.y = Math.max(y(e.v), lastY + 13); lastY = e.y; });
  chart.selectAll('text.series-label').data(ends, d => d.s).join('text').attr('class', 'series-label')
    .attr('x', cw - mg.r + 6).attr('y', d => d.y).attr('dy', '0.35em')
    .attr('fill', d => SCEN_COLOR[d.s])
    .text(d => `${SCEN_NAME[d.s]} ${m.fmt(d.v)}${m.unit}`);
}

function place(c) {
  return `${Math.abs(c.lat)}\u00b0${c.lat >= 0 ? 'N' : 'S'}, ${Math.abs(c.lon)}\u00b0${c.lon >= 0 ? 'E' : 'W'}`;
}

function showTooltip(event, d) {
  const m = MEASURE[state.measure];
  const v = value(state.measure, state.scen, state.decadeIdx, d.idx);
  const g = data.global[state.measure][state.scen][state.decadeIdx];
  tooltip.attr('hidden', null)
    .style('left', (event.clientX + 14) + 'px').style('top', (event.clientY + 14) + 'px')
    .html(`<b>${place(d)}</b><br>${SCEN_NAME[state.scen]}, ${data.decades[state.decadeIdx]}s<br>` +
      `${m.name}: <b>${Number.isNaN(v) ? 'n/a' : m.fmt(v) + m.unit}</b><br>Global mean: ${m.fmt(g)}${m.unit}`);
}

function wireControls() {
  d3.selectAll('#measure-group button').on('click', function () { state.measure = this.dataset.measure; update(); });
  d3.selectAll('#scenario-group button').on('click', function () { state.scen = this.dataset.scen; update(); });
  d3.select('#decade').on('input', function () { stopPlay(); state.decadeIdx = +this.value; update(); });
  d3.select('#play').on('click', () => (state.playing ? stopPlay() : startPlay()));
}

function startPlay() {
  if (state.decadeIdx >= data.decades.length - 1) state.decadeIdx = 0;
  d3.select('#play').html('&#10074;&#10074;');
  state.playing = d3.interval(() => {
    state.decadeIdx += 1;
    d3.select('#decade').property('value', state.decadeIdx);
    update();
    if (state.decadeIdx >= data.decades.length - 1) stopPlay();
  }, 450);
}

function stopPlay() {
  if (state.playing) state.playing.stop();
  state.playing = null;
  d3.select('#play').html('&#9654;');
}
