// Read-only viewer for /u/:username/:slug

const NUM_STRINGS = 5;
const PAD_LEFT = 30;
const PAD_TOP = 18;
const PAD_BOTTOM = 8;
const STRING_GAP = 18;
const MIN_CELL_W = 22;

const els = {
  title: document.getElementById('view-title'),
  sub: document.getElementById('view-sub'),
  staff: document.getElementById('staff-area'),
  actions: document.getElementById('view-actions'),
  notes: document.getElementById('view-notes'),
  notesSection: document.getElementById('view-notes-section'),
  nav: document.getElementById('page-nav'),
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function renderNav() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      const me = (await res.json()).user;
      els.nav.innerHTML = `<a href="/browse">Browse</a><a href="/editor">My tabs</a><span class="muted-link" style="margin-left:14px">${escapeHtml(me.username)}</span>`;
    } else {
      els.nav.innerHTML = `<a href="/browse">Browse</a><a href="/login">Log in</a><a href="/signup">Sign up</a>`;
    }
  } catch {}
}

function ticksPerMeasure(tab) { return tab.timeSignature.num * tab.subdivision; }

function renderMeasure(m, tab, stringNames) {
  const ticks = ticksPerMeasure(tab);
  const cellW = MIN_CELL_W;
  const w = PAD_LEFT + ticks * cellW + 8;
  const h = PAD_TOP + (NUM_STRINGS - 1) * STRING_GAP + PAD_BOTTOM + 14;

  const wrap = document.createElement('div');
  wrap.className = 'measure';

  if (tab.measures[m].label) {
    const label = document.createElement('div');
    label.className = 'measure-label';
    label.textContent = tab.measures[m].label;
    wrap.appendChild(label);
  }

  const chords = tab.measures[m].chords || {};
  if (Object.keys(chords).length > 0) {
    const chordRow = document.createElement('div');
    chordRow.className = 'chord-row';
    chordRow.style.width = `${w}px`;
    const beatWidth = cellW * tab.subdivision;
    const numBeats = tab.timeSignature.num;
    for (let b = 0; b < numBeats; b++) {
      if (!chords[b]) continue;
      const span = document.createElement('span');
      span.className = 'chord-text';
      span.style.left = `${PAD_LEFT + b * beatWidth}px`;
      span.textContent = chords[b];
      chordRow.appendChild(span);
    }
    wrap.appendChild(chordRow);
  } else {
    // keep height consistent with editor so layout matches
    const spacer = document.createElement('div');
    spacer.className = 'chord-row chord-row-empty';
    wrap.appendChild(spacer);
  }

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
      const fret = tab.measures[m].notes[`${s}-${t}`];
      if (fret === undefined) continue;
      const x = PAD_LEFT + t * cellW;
      const y = PAD_TOP + s * STRING_GAP;
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
      svg.appendChild(bg);

      const t2 = document.createElementNS(svgNS, 'text');
      t2.setAttribute('class', 'fret-text');
      t2.setAttribute('x', String(cx));
      t2.setAttribute('y', String(y + 4));
      t2.textContent = text;
      svg.appendChild(t2);
    }
  }

  wrap.appendChild(svg);
  return wrap;
}

function renderStaff(tab) {
  els.staff.innerHTML = '';
  let row = null;
  let rowWidth = 0;
  const w = PAD_LEFT + ticksPerMeasure(tab) * MIN_CELL_W + 8;
  const containerWidth = els.staff.clientWidth || 900;
  for (let m = 0; m < tab.measures.length; m++) {
    if (!row || rowWidth + w > containerWidth) {
      row = document.createElement('div');
      row.className = 'measure-row';
      els.staff.appendChild(row);
      rowWidth = 0;
    }
    rowWidth += w;
    row.appendChild(renderMeasure(m, tab, tab.tuning));
  }
}

(async () => {
  renderNav();
  const m = window.location.pathname.match(/^\/u\/([^/]+)\/([^/]+)$/);
  if (!m) {
    els.title.textContent = 'Not found';
    return;
  }
  const [, username, slug] = m;
  const res = await fetch(`/api/u/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    els.title.textContent = 'Tab not found';
    els.sub.textContent = 'It may have been deleted or set to private.';
    return;
  }
  const tab = await res.json();
  document.title = `${tab.title} · ${username} · Banjo Tabs`;
  els.title.textContent = tab.title;
  els.sub.textContent = `${tab.artist ? tab.artist + ' · ' : ''}by ${username} · ♩=${tab.tempo} · ${tab.timeSignature.num}/${tab.timeSignature.den}`;

  // Actions: visibility tag + edit (if owner) + print
  els.actions.innerHTML = '';
  const visTag = document.createElement('span');
  visTag.className = 'visibility-tag';
  visTag.textContent = tab.visibility;
  els.actions.appendChild(visTag);

  if (tab.isOwner) {
    const editLink = document.createElement('a');
    editLink.href = `/editor/${slug}`;
    editLink.className = 'btn-secondary';
    editLink.textContent = 'Edit';
    els.actions.appendChild(editLink);
  }
  const printBtn = document.createElement('button');
  printBtn.className = 'btn-secondary';
  printBtn.textContent = 'Print';
  printBtn.onclick = () => window.print();
  els.actions.appendChild(printBtn);

  if (tab.notes) {
    els.notes.textContent = tab.notes;
    els.notesSection.hidden = false;
  }
  renderStaff(tab);
})();

window.addEventListener('resize', () => {
  // re-fetch wouldn't be ideal; just no-op for now
});
