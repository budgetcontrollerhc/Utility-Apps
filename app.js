// ============================================================
// ONE-TIME SETUP — the only value you hardcode.
// Paste your Apps Script Web App URL (ends in /exec).
// Everything else is managed from inside the app.
// ============================================================
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbyh6kTpvIm_3yS0RTgqWMVpPbvBOycsFgpR50VvcNU1cBd9D3kId8LHL6fjoxxxC8tX/exec'
};
// ============================================================

let state = {
  token: null,
  mobile: null,
  name: null,
  isAdmin: false,
  apps: [],
  users: [],
  adminOpen: false,
  authMode: 'login' // 'login' | 'signup'
};

const appEl = document.getElementById('app');
const toastEl = document.getElementById('toast');

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2400);
}

// ---------- Backend calls ----------
// GET for reads/admin actions (token in query string — fine, it's a
// session token, not the password). POST for signup/login so the
// password itself is never written into a URL.
async function apiGet(action, params) {
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('token', state.token || '');
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  return res.json();
}

async function apiPost(action, params) {
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
    body: JSON.stringify({ action, ...params })
  });
  return res.json();
}

// ---------- Boot ----------
window.onload = () => {
  const saved = localStorage.getItem('launcher_token');
  if (saved) {
    state.token = saved;
    checkSession();
  } else {
    renderAuth();
  }
};

async function checkSession() {
  try {
    const data = await apiGet('checkSession');
    if (!data.authorized) {
      localStorage.removeItem('launcher_token');
      state.token = null;
      renderAuth();
      return;
    }
    state.mobile = data.mobile;
    state.name = data.name;
    state.isAdmin = !!data.isAdmin;
    state.apps = data.apps || [];
    renderMain();
  } catch (err) {
    renderAuth('Could not reach the launcher server. Check your connection.');
  }
}

// ---------- Auth screens ----------
function renderAuth(statusMsg, statusIsError) {
  const isSignup = state.authMode === 'signup';
  appEl.innerHTML = `
    <div class="auth-screen">
      <div class="auth-mark"><span></span><span></span><span></span><span></span></div>
      <div class="auth-card">
        <h1>${isSignup ? 'Create account' : 'Sign in'}</h1>
        <div class="sub">${isSignup ? 'New accounts need admin approval before use.' : 'Use your mobile number and password.'}</div>

        ${isSignup ? `
        <div class="field">
          <label>Name</label>
          <input id="fName" type="text" autocomplete="name" placeholder="Your name">
        </div>` : ''}

        <div class="field">
          <label>Mobile number</label>
          <input id="fMobile" type="tel" autocomplete="tel" placeholder="e.g. 9876543210">
        </div>
        <div class="field">
          <label>Password</label>
          <input id="fPassword" type="password" autocomplete="${isSignup ? 'new-password' : 'current-password'}" placeholder="At least 6 characters">
        </div>
        ${isSignup ? `
        <div class="field">
          <label>Confirm password</label>
          <input id="fPassword2" type="password" autocomplete="new-password" placeholder="Re-enter password">
        </div>` : ''}

        <button class="auth-btn" id="authSubmitBtn">${isSignup ? 'Request access' : 'Sign in'}</button>
        <div class="auth-switch">
          ${isSignup ? "Already have an account? " : "New here? "}
          <button id="authSwitchBtn">${isSignup ? 'Sign in' : 'Request access'}</button>
        </div>
        <div class="auth-status ${statusIsError ? 'error' : (statusMsg ? 'ok' : '')}" id="authStatus">${statusMsg || ''}</div>
      </div>
    </div>
  `;
  document.getElementById('authSwitchBtn').onclick = () => {
    state.authMode = isSignup ? 'login' : 'signup';
    renderAuth();
  };
  document.getElementById('authSubmitBtn').onclick = isSignup ? submitSignup : submitLogin;
  // Enter key submits
  appEl.querySelectorAll('.auth-card input').forEach(inp => {
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') (isSignup ? submitSignup : submitLogin)(); });
  });
}

async function submitLogin() {
  const mobile = document.getElementById('fMobile').value.trim();
  const password = document.getElementById('fPassword').value;
  if (!mobile || !password) { renderAuth('Enter your mobile number and password', true); return; }
  const statusEl = document.getElementById('authStatus');
  statusEl.textContent = 'Signing in...'; statusEl.className = 'auth-status';
  try {
    const data = await apiPost('login', { mobile, password });
    if (data.error) { renderAuth(data.error, true); return; }
    state.token = data.token;
    state.mobile = data.mobile;
    state.name = data.name;
    state.isAdmin = !!data.isAdmin;
    state.apps = data.apps || [];
    localStorage.setItem('launcher_token', data.token);
    renderMain();
  } catch (err) {
    renderAuth('Could not reach the launcher server.', true);
  }
}

async function submitSignup() {
  const name = document.getElementById('fName').value.trim();
  const mobile = document.getElementById('fMobile').value.trim();
  const password = document.getElementById('fPassword').value;
  const password2 = document.getElementById('fPassword2').value;
  if (!mobile || !password) { renderAuth('Mobile number and password are required', true); return; }
  if (password.length < 6) { renderAuth('Password must be at least 6 characters', true); return; }
  if (password !== password2) { renderAuth('Passwords do not match', true); return; }
  const statusEl = document.getElementById('authStatus');
  statusEl.textContent = 'Submitting...'; statusEl.className = 'auth-status';
  try {
    const data = await apiPost('signup', { name, mobile, password });
    if (data.error) { renderAuth(data.error, true); return; }
    if (data.token) {
      // First-ever account: auto-approved and logged straight in.
      state.token = data.token;
      state.mobile = data.mobile;
      state.name = data.name;
      state.isAdmin = !!data.isAdmin;
      state.apps = data.apps || [];
      localStorage.setItem('launcher_token', data.token);
      renderMain();
      return;
    }
    state.authMode = 'login';
    renderAuth(data.message || 'Request submitted. Wait for admin approval.', false);
  } catch (err) {
    renderAuth('Could not reach the launcher server.', true);
  }
}

function signOut() {
  apiGet('logout').catch(() => {});
  localStorage.removeItem('launcher_token');
  state = { token: null, mobile: null, name: null, isAdmin: false, apps: [], users: [], adminOpen: false, authMode: 'login' };
  renderAuth();
}

// ---------- Main app ----------
function renderMain() {
  appEl.innerHTML = `
    <header>
      <h1>My Apps</h1>
      <div class="head-right">
        <span class="chip">${escapeHtml(state.name || state.mobile)}</span>
        ${state.isAdmin ? `<button class="btn" id="toggleAdminBtn">${state.adminOpen ? 'Close admin' : 'Manage'}</button>` : ''}
        <button class="btn" id="signOutBtn">Sign out</button>
      </div>
    </header>
    <main>
      <div class="search-row">
        <input id="search" type="text" placeholder="Search apps...">
      </div>
      <div class="grid" id="grid"></div>
      <div class="empty" id="emptyMsg" style="display:none;">No apps match your search.</div>
      ${state.isAdmin && state.adminOpen ? renderAdminPanel() : ''}
    </main>
  `;
  document.getElementById('signOutBtn').onclick = signOut;
  if (state.isAdmin) {
    document.getElementById('toggleAdminBtn').onclick = async () => {
      state.adminOpen = !state.adminOpen;
      if (state.adminOpen) {
        const data = await apiGet('listUsers');
        state.users = data.users || [];
      }
      renderMain();
    };
  }
  document.getElementById('search').addEventListener('input', renderGrid);
  renderGrid();
  if (state.isAdmin && state.adminOpen) wireAdminPanel();
}

function renderGrid() {
  const q = (document.getElementById('search').value || '').toLowerCase();
  const grid = document.getElementById('grid');
  const filtered = state.apps.filter(a => a.name.toLowerCase().includes(q));
  document.getElementById('emptyMsg').style.display = filtered.length ? 'none' : 'block';
  grid.innerHTML = filtered.map(a => `
    <a class="tile" href="${escapeAttr(a.url)}" target="_blank" rel="noopener">
      <div class="icon">${escapeHtml(a.icon || '🔗')}</div>
      <div class="name">${escapeHtml(a.name)}</div>
      <div class="desc">${escapeHtml(a.description || '')}</div>
    </a>
  `).join('');
}

function renderAdminPanel() {
  const pending = state.users.filter(u => u.status === 'pending');
  const active = state.users.filter(u => u.status === 'active');

  return `
    ${pending.length ? `
    <div class="admin-section">
      <h2>Pending requests</h2>
      <p class="section-sub">New signups wait here until you approve them.</p>
      <div class="admin-list">
        ${pending.map(u => `
          <div class="admin-row">
            <span>${escapeHtml(u.name || '(no name)')} <span class="meta">${escapeHtml(u.mobile)}</span> <span class="pending-tag">pending</span></span>
            <span class="actions">
              <button class="btn small ok" data-approve="${escapeAttr(u.mobile)}">Approve</button>
              <button class="btn small danger" data-reject="${escapeAttr(u.mobile)}">Reject</button>
            </span>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    <div class="admin-section">
      <h2>Apps</h2>
      <div class="admin-list">
        ${state.apps.map(a => `
          <div class="admin-row" data-id="${a.id}">
            <span>${escapeHtml(a.icon || '🔗')} <strong>${escapeHtml(a.name)}</strong> <span class="meta">${escapeHtml(a.description || '')}</span></span>
            <button class="btn small danger" data-delete-app="${a.id}">Remove</button>
          </div>
        `).join('') || '<div class="meta">No apps yet — add one below.</div>'}
      </div>
      <div class="form-grid">
        <input id="newIcon" placeholder="🔗" maxlength="4">
        <input id="newName" placeholder="App name">
        <input id="newUrl" placeholder="App URL (https://...)">
      </div>
      <div class="form-grid" style="grid-template-columns: 1fr;">
        <input id="newDesc" placeholder="Short description (optional)">
      </div>
      <div class="form-actions">
        <button class="btn primary" id="addAppBtn">Add app</button>
      </div>
    </div>

    <div class="admin-section">
      <h2>Members</h2>
      <p class="section-sub">Approved users who can sign in.</p>
      <div class="admin-list">
        ${active.map(u => `
          <div class="admin-row">
            <span>${escapeHtml(u.name || '(no name)')} <span class="meta">${escapeHtml(u.mobile)}</span> ${u.role === 'admin' ? '<span class="role-tag">admin</span>' : ''}</span>
            <span class="actions">
              <button class="btn small" data-toggle-role="${escapeAttr(u.mobile)}" data-current-role="${u.role}">${u.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>
              <button class="btn small" data-reset="${escapeAttr(u.mobile)}">Reset password</button>
              <button class="btn small danger" data-remove-user="${escapeAttr(u.mobile)}">Remove</button>
            </span>
          </div>
        `).join('') || '<div class="meta">No members yet.</div>'}
      </div>
    </div>
  `;
}

function wireAdminPanel() {
  document.getElementById('addAppBtn').onclick = async () => {
    const name = document.getElementById('newName').value.trim();
    const url = document.getElementById('newUrl').value.trim();
    const icon = document.getElementById('newIcon').value.trim() || '🔗';
    const description = document.getElementById('newDesc').value.trim();
    if (!name || !url) { toast('Name and URL are required'); return; }
    await apiGet('addApp', { name, url, icon, description });
    toast('App added');
    await refreshApps();
  };

  document.querySelectorAll('[data-delete-app]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Remove this app for everyone?')) return;
      await apiGet('deleteApp', { id: btn.getAttribute('data-delete-app') });
      toast('App removed');
      await refreshApps();
    };
  });

  document.querySelectorAll('[data-approve]').forEach(btn => {
    btn.onclick = async () => {
      await apiGet('approveUser', { mobile: btn.getAttribute('data-approve') });
      toast('Approved');
      await refreshUsers();
    };
  });
  document.querySelectorAll('[data-reject]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Reject this request? They will need to sign up again.')) return;
      await apiGet('rejectUser', { mobile: btn.getAttribute('data-reject') });
      toast('Rejected');
      await refreshUsers();
    };
  });
  document.querySelectorAll('[data-remove-user]').forEach(btn => {
    btn.onclick = async () => {
      const mobile = btn.getAttribute('data-remove-user');
      if (mobile === state.mobile) { toast("You can't remove yourself"); return; }
      if (!confirm('Remove this member?')) return;
      const data = await apiGet('removeUser', { mobile });
      if (data.error) { toast(data.error); return; }
      toast('Removed');
      await refreshUsers();
    };
  });
  document.querySelectorAll('[data-toggle-role]').forEach(btn => {
    btn.onclick = async () => {
      const mobile = btn.getAttribute('data-toggle-role');
      const current = btn.getAttribute('data-current-role');
      await apiGet('setRole', { mobile, role: current === 'admin' ? 'user' : 'admin' });
      toast('Updated');
      await refreshUsers();
    };
  });
  document.querySelectorAll('[data-reset]').forEach(btn => {
    btn.onclick = async () => {
      const mobile = btn.getAttribute('data-reset');
      const newPassword = prompt('Enter a new temporary password for this member (at least 6 characters), then share it with them directly:');
      if (!newPassword) return;
      const data = await apiGet('resetPassword', { mobile, newPassword });
      if (data.error) { toast(data.error); return; }
      toast('Password reset');
    };
  });
}

async function refreshApps() {
  const data = await apiGet('listApps');
  state.apps = data.apps || [];
  renderMain();
}
async function refreshUsers() {
  const data = await apiGet('listUsers');
  state.users = data.users || [];
  renderMain();
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// ---------- Register service worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
