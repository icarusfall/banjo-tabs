// Public-tabs listing

const els = {
  list: document.getElementById('public-list'),
  empty: document.getElementById('empty'),
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
      els.nav.innerHTML = `<a href="/editor">My tabs</a><span class="muted-link" style="margin-left:14px">${escapeHtml(me.username)}</span>`;
    } else {
      els.nav.innerHTML = `<a href="/login">Log in</a><a href="/signup">Sign up</a>`;
    }
  } catch {}
}

(async () => {
  renderNav();
  const res = await fetch('/api/browse');
  if (!res.ok) return;
  const tabs = await res.json();
  if (tabs.length === 0) {
    els.empty.hidden = false;
    return;
  }
  for (const t of tabs) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `/u/${encodeURIComponent(t.username)}/${encodeURIComponent(t.slug)}`;
    a.textContent = t.title;
    const meta = document.createElement('span');
    meta.className = 'meta';
    const updated = t.updatedAt ? new Date(t.updatedAt).toLocaleDateString() : '';
    meta.textContent = `${t.artist ? t.artist + ' · ' : ''}by ${t.username}${updated ? ' · ' + updated : ''}`;
    li.append(a, meta);
    els.list.appendChild(li);
  }
})();
