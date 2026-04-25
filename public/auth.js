// Login + signup form handlers (shared between /login and /signup)

const errorEl = document.getElementById('error');

function showError(msg) {
  if (!errorEl) return;
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function nextUrl() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/editor';
}

async function submit(form, endpoint) {
  errorEl?.setAttribute('hidden', '');
  const data = Object.fromEntries(new FormData(form).entries());
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch {
    showError('Network error — please try again');
    return;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    showError(body.error || 'Something went wrong');
    return;
  }
  window.location.href = nextUrl();
}

const loginForm = document.getElementById('login-form');
loginForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  submit(loginForm, '/api/auth/login');
});

const signupForm = document.getElementById('signup-form');
signupForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  submit(signupForm, '/api/auth/signup');
});
