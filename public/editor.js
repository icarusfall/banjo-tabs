// Banjo Tab Editor — multi-user client
// Strings (top-to-bottom in standard 5-string banjo tab):
//   index 0 = D (1st), 1 = B (2nd), 2 = G (3rd), 3 = D (4th), 4 = g (5th drone)

const NUM_STRINGS = 5;

const state = {
  user: null,
  list: [],
  currentSlug: null,
  tab: null,
  selected: { measure: 0, string: 0, tick: 0 },
  saveTimer: null,
  pendingDigit: null,
  pendingDigitTimer: null,
  dirty: false,
};

const els = {
  list: document.getElementById('tab-list'),
  staff: document.getElementById('staff-area'),
  title: document.getElementById('meta-title'),
  artist: document.getElementById('meta-artist'),
  tempo: document.getElementById('meta-tempo'),
  timesig: document.getElementById('meta-timesig'),
  subdivision: document.getElementById('meta-subdivision'),
  visibility: document.getElementById('meta-visibility'),
  notes: document.getElementById('meta-notes'),
  printTitle: document.getElementById('print-title'),
  saveIndicator: document.getElementById('save-indicator'),
  btnNew: document.getElementById('btn-new'),
  btnAddMeasure: document.getElementById('btn-add-measure'),
  btnPrint: document.getElementById('btn-print'),
  btnShare: document.getElementById('btn-share'),
  btnLogout: document.getElementById('btn-logout'),
  userUsername: document.getElementById('user-username'),
};

// ---------- API helper that handles 401 ----------
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (res.status === 401) {
    window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
    throw new Error('not authenticated');
  }
  return res;
}

// ---------- Load current user ----------
async function loadMe() {
  const res = await api('/api/me');
  if (!res.ok) throw new Error('me failed');
  const data = await res.json();
  state.user = data.user;
  els.userUsername.textContent = data.user.username;
}

els.btnLogout?.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});

// ---------- Tab list ----------
async function loadList() {
  const res = await api('/api/tabs');
  state.list = await res.json();
  renderList();
}

function renderList() {
  els.list.innerHTML = '';
  if (state.list.length === 0) {
    const li = document.createElement('li');
    li.style.color = 'var(--muted)';
    li.style.fontSize = '13px';
    li.style.cursor = 'default';
    li.textContent = 'No tabs yet — click + New';
    els.list.appendChild(li);
    return;
  }
  for (const t of state.list) {
    const li = document.createElement('li');
    if (t.slug === state.currentSlug) li.classList.add('active');

    const dot = document.createElement('span');
    dot.className = `vis-dot ${t.visibility}`;
    dot.title = t.visibility;
    li.appendChild(dot);

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = t.title || t.slug;

    const artist = document.createElement('span');
    artist.className = 'artist';
    artist.textContent = t.artist || ' ';

    const actions = document.createElement('span');
    actions.className = 'row-actions';
    const renameBtn = document.createElement('button');
    renameBtn.title = 'Rename';
    renameBtn.textContent = '✎';
    renameBtn.onclick = (e) => { e.stopPropagation(); renameTab(t.slug, t.title); };
    const delBtn = document.createElement('button');
    delBtn.title = 'Delete';
    delBtn.textContent = '✕';
    delBtn.onclick = (e) => { e.stopPropagation(); deleteTab(t.slug, t.title); };
    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);

    li.append(title, artist, actions);
    li.onclick = () => loadTab(t.slug);
    els.list.appendChild(li);
  }
}

async function newTab() {
  const title = prompt('Title for the new tab:', 'Untitled');
  if (title === null) return;
  const res = await api('/api/tabs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title.trim() || 'Untitled' }),
  });
  const data = await res.json();
  await loadList();
  await loadTab(data.slug);
}

async function renameTab(slug, currentTitle) {
  const next = prompt('Rename tab:', currentTitle);
  if (!next || next === currentTitle) return;
  const res = await api(`/api/tabs/${slug}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: next.trim() }),
  });
  const data = await res.json();
  await loadList();
  if (state.currentSlug === slug) {
    await loadTab(data.slug);
  }
}

async function deleteTab(slug, title) {
  if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
  await api(`/api/tabs/${slug}`, { method: 'DELETE' });
  if (state.currentSlug === slug) {
    state.currentSlug = null;
    state.tab = null;
  }
  await loadList();
  if (!state.currentSlug && state.list[0]) {
    await loadTab(state.list[0].slug);
  } else if (!state.currentSlug) {
    els.staff.innerHTML = '';
    setMetaFromTab(null);
    history.replaceState({}, '', '/editor');
  }
}

// ---------- Load / save ----------
async function loadTab(slug) {
  if (state.dirty) await flushSave(true);

  const res = await api(`/api/tabs/${slug}`);
  if (!res.ok) return;
  state.tab = await res.json();
  state.currentSlug = state.tab.slug;
  state.selected = { measure: 0, string: 0, tick: 0 };
  setMetaFromTab(state.tab);
  renderStaff();
  renderList();
  history.replaceState({}, '', `/editor/${state.currentSlug}`);
  localStorage.setItem('banjo-tab:last', state.currentSlug);
}

function setMetaFromTab(tab) {
  if (!tab) {
    els.title.value = '';
    els.artist.value = '';
    els.tempo.value = '';
    els.notes.value = '';
    els.visibility.value = 'private';
    els.printTitle.innerHTML = '';
    return;
  }
  els.title.value = tab.title || '';
  els.artist.value = tab.artist || '';
  els.tempo.value = tab.tempo || 120;
  els.timesig.value = `${tab.timeSignature.num}/${tab.timeSignature.den}`;
  els.subdivision.value = String(tab.subdivision);
  els.visibility.value = tab.visibility || 'private';
  els.notes.value = tab.notes || '';
  els.printTitle.innerHTML = `<h2>${escapeHtml(tab.title || '')}</h2><div class="sub">${escapeHtml(tab.artist || '')} · ♩=${tab.tempo} · ${tab.timeSignature.num}/${tab.timeSignature.den}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function markDirty() {
  state.dirty = true;
  setSaveStatus('saving', 'Saving…');
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSave, 350);
  try {
    localStorage.setItem(`banjo-tab:backup:${state.currentSlug}`, JSON.stringify(state.tab));
  } catch {}
}

async function flushSave(immediate = false) {
  if (!state.tab || !state.currentSlug) return;
  if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
  try {
    const res = await fetch(`/api/tabs/${state.currentSlug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.tab),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!res.ok) throw new Error('save failed');
    state.dirty = false;
    setSaveStatus('ok', 'Saved');
    if (!immediate) loadList();
  } catch {
    setSaveStatus('error', 'Offline');
  }
}

function setSaveStatus(kind, text) {
  els.saveIndicator.className = `save-indicator ${kind === 'ok' ? '' : kind}`;
  els.saveIndicator.textContent = text;
}

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------- Meta field bindings ----------
els.title.addEventListener('input', () => {
  if (!state.tab) return;
  state.tab.title = els.title.value;
  const h2 = els.printTitle.querySelector('h2');
  if (h2) h2.textContent = state.tab.title;
  markDirty();
});
els.artist.addEventListener('input', () => {
  if (!state.tab) return;
  state.tab.artist = els.artist.value;
  const sub = els.printTitle.querySelector('.sub');
  if (sub) sub.firstChild.nodeValue = `${state.tab.artist} · `;
  markDirty();
});
els.tempo.addEventListener('input', () => {
  if (!state.tab) return;
  state.tab.tempo = parseInt(els.tempo.value, 10) || 0;
  markDirty();
});
els.timesig.addEventListener('change', () => {
  if (!state.tab) return;
  const [num, den] = els.timesig.value.split('/').map(Number);
  state.tab.timeSignature = { num, den };
  renderStaff();
  markDirty();
});
els.subdivision.addEventListener('change', () => {
  if (!state.tab) return;
  state.tab.subdivision = parseInt(els.subdivision.value, 10);
  renderStaff();
  markDirty();
});
els.visibility.addEventListener('change', async () => {
  if (!state.tab) return;
  state.tab.visibility = els.visibility.value;
  try {
    const res = await api(`/api/tabs/${state.currentSlug}/visibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: state.tab.visibility }),
    });
    if (res.ok) renderList();
  } catch {}
});
els.notes.addEventListener('input', () => {
  if (!state.tab) return;
  state.tab.notes = els.notes.value;
  markDirty();
});

els.btnNew.onclick = newTab;
els.btnAddMeasure.onclick = addMeasure;
els.btnPrint.onclick = () => window.print();
els.btnShare.onclick = async () => {
  if (!state.tab || !state.user) return;
  if (state.tab.visibility === 'private') {
    if (!confirm('This tab is Private — switch it to Unlisted so the link works for others?')) return;
    els.visibility.value = 'unlisted';
    state.tab.visibility = 'unlisted';
    els.visibility.dispatchEvent(new Event('change'));
  }
  const url = `${window.location.origin}/u/${state.user.username}/${state.currentSlug}`;
  try {
    await navigator.clipboard.writeText(url);
    setSaveStatus('ok', 'Link copied');
    setTimeout(() => setSaveStatus('ok', 'Saved'), 1500);
  } catch {
    prompt('Share link:', url);
  }
};

// ---------- Geometry ----------
const PAD_LEFT = 30;
const PAD_TOP = 18;
const PAD_BOTTOM = 8;
const STRING_GAP = 18;
const MIN_CELL_W = 22;

function ticksPerMeasure(tab) {
  return tab.timeSignature.num * tab.subdivision;
}

function measureWidth(tab) {
  const ticks = ticksPerMeasure(tab);
  return PAD_LEFT + ticks * MIN_CELL_W + 8;
}

function measureHeight() {
  return PAD_TOP + (NUM_STRINGS - 1) * STRING_GAP + PAD_BOTTOM + 14;
}

// ---------- Render staff ----------
function renderStaff() {
  els.staff.innerHTML = '';
  if (!state.tab) return;

  const tab = state.tab;
  const ticks = ticksPerMeasure(tab);
  const cellW = MIN_CELL_W;
  const w = measureWidth(tab);
  const h = measureHeight();
  const stringNames = tab.tuning;

  let row = null;
  let rowWidth = 0;
  const containerWidth = els.staff.clientWidth || 900;

  for (let m = 0; m < tab.measures.length; m++) {
    if (!row || rowWidth + w > containerWidth) {
      row = document.createElement('div');
      row.className = 'measure-row';
      els.staff.appendChild(row);
      rowWidth = 0;
    }
    rowWidth += w;
    row.appendChild(renderMeasure(m, tab, ticks, cellW, w, h, stringNames));
  }
}

function renderMeasure(m, tab, ticks, cellW, w, h, stringNames) {
  const wrap = document.createElement('div');
  wrap.className = 'measure';
  wrap.dataset.measure = String(m);

  const label = document.createElement('div');
  label.className = 'measure-label';
  const labelInput = document.createElement('input');
  labelInput.value = tab.measures[m].label || '';
  labelInput.placeholder = `m${m + 1}`;
  labelInput.addEventListener('input', () => {
    tab.measures[m].label = labelInput.value;
    markDirty();
  });
  label.appendChild(labelInput);
  wrap.appendChild(label);

  const ctrls = document.createElement('div');
  ctrls.className = 'measure-controls';
  const addBtn = document.createElement('button');
  addBtn.title = 'Insert measure after';
  addBtn.textContent = '+';
  addBtn.onclick = () => insertMeasure(m + 1);
  const delBtn = document.createElement('button');
  delBtn.title = 'Delete measure';
  delBtn.textContent = '−';
  delBtn.onclick = () => removeMeasure(m);
  ctrls.append(addBtn, delBtn);
  wrap.appendChild(ctrls);

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  for (let s = 0; s < NUM_STRINGS; s++) {
    const y = PAD_TOP + s * STRING_GAP;
    const lbl = document.createElementNS(svgNS, 'text');
    lbl.setAttribute('class', 'string-label');
    lbl.setAttribute('x', String(PAD_LEFT - 6));
    lbl.setAttribute('y', String(y + 4));
    lbl.textContent = stringNames[s] || '';
    svg.appendChild(lbl);

    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('class', 'string-line');
    line.setAttribute('x1', String(PAD_LEFT));
    line.setAttribute('y1', String(y));
    line.setAttribute('x2', String(PAD_LEFT + ticks * cellW));
    line.setAttribute('y2', String(y));
    svg.appendChild(line);
  }

  const subdiv = tab.subdivision;
  for (let t = 0; t <= ticks; t++) {
    const x = PAD_LEFT + t * cellW;
    const isStrong = t % subdiv === 0;
    const isBar = t === 0 || t === ticks;
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('class', isBar ? 'barline' : isStrong ? 'beat-strong' : 'beat-weak');
    line.setAttribute('x1', String(x));
    line.setAttribute('y1', String(PAD_TOP - 6));
    line.setAttribute('x2', String(x));
    line.setAttribute('y2', String(PAD_TOP + (NUM_STRINGS - 1) * STRING_GAP + 6));
    svg.appendChild(line);

    if (isStrong && t < ticks) {
      const num = document.createElementNS(svgNS, 'text');
      num.setAttribute('class', 'beat-num');
      num.setAttribute('x', String(x + cellW * subdiv / 2));
      num.setAttribute('y', String(PAD_TOP - 8));
      num.textContent = String((t / subdiv) + 1);
      svg.appendChild(num);
    }
  }

  for (let s = 0; s < NUM_STRINGS; s++) {
    for (let t = 0; t < ticks; t++) {
      const x = PAD_LEFT + t * cellW;
      const y = PAD_TOP + s * STRING_GAP;

      const hit = document.createElementNS(svgNS, 'rect');
      hit.setAttribute('class', 'cell-hit');
      hit.setAttribute('x', String(x));
      hit.setAttribute('y', String(y - STRING_GAP / 2));
      hit.setAttribute('width', String(cellW));
      hit.setAttribute('height', String(STRING_GAP));
      if (state.selected.measure === m && state.selected.string === s && state.selected.tick === t) {
        hit.classList.add('selected');
      }
      hit.addEventListener('click', (e) => {
        selectCell(m, s, t);
        e.stopPropagation();
      });
      hit.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const key = `${s}-${t}`;
        if (tab.measures[m].notes[key] !== undefined) {
          delete tab.measures[m].notes[key];
          markDirty();
          renderStaff();
        }
      });
      svg.appendChild(hit);

      const fret = tab.measures[m].notes[`${s}-${t}`];
      if (fret !== undefined) {
        const cx = x + cellW / 2;
        const text = String(fret);
        const padX = text.length === 1 ? 5 : 7;
        const bg = document.createElementNS(svgNS, 'rect');
        bg.setAttribute('class', 'fret-bg');
        bg.setAttribute('x', String(cx - padX - 1));
        bg.setAttribute('y', String(y - 8));
        bg.setAttribute('width', String((padX + 1) * 2));
        bg.setAttribute('height', '16');
        bg.setAttribute('rx', '2');
        bg.style.pointerEvents = 'none';
        svg.appendChild(bg);

        const t2 = document.createElementNS(svgNS, 'text');
        t2.setAttribute('class', 'fret-text');
        t2.setAttribute('x', String(cx));
        t2.setAttribute('y', String(y + 4));
        t2.textContent = text;
        t2.style.pointerEvents = 'none';
        svg.appendChild(t2);
      }
    }
  }

  wrap.appendChild(svg);
  return wrap;
}

// ---------- Selection / editing ----------
function selectCell(m, s, t) {
  state.selected = { measure: m, string: s, tick: t };
  state.pendingDigit = null;
  renderStaff();
}

function moveSelection(dm, ds, dt) {
  if (!state.tab) return;
  let { measure, string, tick } = state.selected;
  const ticks = ticksPerMeasure(state.tab);

  string = Math.max(0, Math.min(NUM_STRINGS - 1, string + ds));
  tick += dt;
  while (tick < 0) {
    if (measure > 0) { measure -= 1; tick += ticks; }
    else { tick = 0; break; }
  }
  while (tick >= ticks) {
    if (measure < state.tab.measures.length - 1) { measure += 1; tick -= ticks; }
    else { tick = ticks - 1; break; }
  }
  measure = Math.max(0, Math.min(state.tab.measures.length - 1, measure + dm));
  state.selected = { measure, string, tick };
  state.pendingDigit = null;
  renderStaff();
}

function setFret(fret) {
  if (!state.tab) return;
  const { measure, string, tick } = state.selected;
  state.tab.measures[measure].notes[`${string}-${tick}`] = fret;
  markDirty();
  renderStaff();
}

function clearCell() {
  if (!state.tab) return;
  const { measure, string, tick } = state.selected;
  const key = `${string}-${tick}`;
  if (state.tab.measures[measure].notes[key] !== undefined) {
    delete state.tab.measures[measure].notes[key];
    markDirty();
    renderStaff();
  }
}

function advanceTick(n = 1) {
  moveSelection(0, 0, n);
}

function handleDigit(d) {
  if (!state.tab) return;
  const now = Date.now();
  if (state.pendingDigit !== null && now - state.pendingDigit.at < 500) {
    const combined = state.pendingDigit.value * 10 + d;
    if (combined <= 24) {
      state.selected = { ...state.pendingDigit.cell };
      setFret(combined);
      advanceTick(1);
      state.pendingDigit = null;
      return;
    }
  }
  const cell = { ...state.selected };
  setFret(d);
  state.pendingDigit = { value: d, at: now, cell };
  advanceTick(1);
  if (state.pendingDigitTimer) clearTimeout(state.pendingDigitTimer);
  state.pendingDigitTimer = setTimeout(() => { state.pendingDigit = null; }, 500);
}

document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (!state.tab) return;

  if (/^[0-9]$/.test(e.key)) {
    handleDigit(parseInt(e.key, 10));
    e.preventDefault();
    return;
  }
  switch (e.key) {
    case 'ArrowLeft':  moveSelection(0, 0, -1); e.preventDefault(); break;
    case 'ArrowRight': moveSelection(0, 0,  1); e.preventDefault(); break;
    case 'ArrowUp':    moveSelection(0, -1, 0); e.preventDefault(); break;
    case 'ArrowDown':  moveSelection(0,  1, 0); e.preventDefault(); break;
    case ' ':          advanceTick(1); e.preventDefault(); break;
    case 'Backspace':  clearCell(); moveSelection(0, 0, -1); e.preventDefault(); break;
    case 'Delete':     clearCell(); e.preventDefault(); break;
    case 'Enter': {
      const m = Math.min(state.selected.measure + 1, state.tab.measures.length - 1);
      state.selected = { measure: m, string: state.selected.string, tick: 0 };
      renderStaff();
      e.preventDefault();
      break;
    }
  }
});

// ---------- Measures ----------
function addMeasure() {
  if (!state.tab) return;
  state.tab.measures.push({ label: '', notes: {} });
  markDirty();
  renderStaff();
}

function insertMeasure(at) {
  if (!state.tab) return;
  state.tab.measures.splice(at, 0, { label: '', notes: {} });
  markDirty();
  renderStaff();
}

function removeMeasure(idx) {
  if (!state.tab) return;
  if (state.tab.measures.length <= 1) return;
  if (!confirm(`Delete measure ${idx + 1}?`)) return;
  state.tab.measures.splice(idx, 1);
  if (state.selected.measure >= state.tab.measures.length) {
    state.selected.measure = state.tab.measures.length - 1;
  }
  markDirty();
  renderStaff();
}

window.addEventListener('resize', () => {
  if (state.tab) renderStaff();
});

// ---------- Boot ----------
function pathSlug() {
  const m = window.location.pathname.match(/^\/editor\/([^/]+)$/);
  return m ? m[1] : null;
}

(async () => {
  try {
    await loadMe();
    await loadList();
  } catch {
    return; // 401 redirect already triggered
  }

  const pathTarget = pathSlug();
  const last = localStorage.getItem('banjo-tab:last');
  const targetSlug = pathTarget
    || (state.list.find((t) => t.slug === last)?.slug)
    || state.list[0]?.slug;

  if (targetSlug) {
    await loadTab(targetSlug);
  } else {
    // First-time: create a starter tab
    const res = await api('/api/tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Untitled' }),
    });
    const data = await res.json();
    await loadList();
    await loadTab(data.slug);
  }
})();
