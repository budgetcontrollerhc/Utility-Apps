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
  authMode: 'login', // 'login' | 'signup'
  editingAppId: null
};
let pendingEditThumbDataUrl = null;

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
    body: JSON.stringify({ action, token: state.token || '', ...params })
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
          <div class="pw-wrap">
            <input id="fPassword" type="password" autocomplete="${isSignup ? 'new-password' : 'current-password'}" placeholder="At least 6 characters">
            <button type="button" class="pw-toggle" data-toggle-for="fPassword">Show</button>
          </div>
        </div>
        ${isSignup ? `
        <div class="field">
          <label>Confirm password</label>
          <div class="pw-wrap">
            <input id="fPassword2" type="password" autocomplete="new-password" placeholder="Re-enter password">
            <button type="button" class="pw-toggle" data-toggle-for="fPassword2">Show</button>
          </div>
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
  appEl.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.onclick = () => {
      const inp = document.getElementById(btn.getAttribute('data-toggle-for'));
      const showing = inp.type === 'text';
      inp.type = showing ? 'password' : 'text';
      btn.textContent = showing ? 'Show' : 'Hide';
    };
  });
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
    document.getElementById('toggleAdminBtn').onclick = () => {
      state.adminOpen = !state.adminOpen;
      renderMain();
      if (state.adminOpen) {
        apiGet('listUsers').then(data => {
          state.users = data.users || [];
          if (state.adminOpen) renderMain();
        }).catch(err => {
          console.error('listUsers failed:', err);
          toast('Could not load members list');
        });
      }
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
  grid.innerHTML = filtered.map((a, i) => `
    <a class="tile" style="animation-delay:${Math.min(i * 40, 400)}ms" href="${escapeAttr(a.url)}" target="_blank" rel="noopener">
      ${a.thumbnail
        ? `<img class="bg-img" src="${escapeAttr(a.thumbnail)}" alt="">`
        : `<div class="icon-fallback">${escapeHtml(a.icon || '🔗')}</div>`}
      <div class="overlay">
        <div class="name">${escapeHtml(a.name)}</div>
        <div class="desc">${escapeHtml(a.description || '')}</div>
      </div>
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
        ${state.apps.map(a => a.id === state.editingAppId ? renderAppEditRow(a) : `
          <div class="admin-row" data-id="${a.id}">
            <span>${a.thumbnail ? `<img src="${escapeAttr(a.thumbnail)}" alt="" style="width:20px;height:20px;border-radius:5px;object-fit:cover;vertical-align:-4px;margin-right:4px;">` : escapeHtml(a.icon || '🔗')} <strong>${escapeHtml(a.name)}</strong> <span class="meta">${escapeHtml(a.description || '')}</span></span>
            <span class="actions">
              <button class="btn small" data-edit-app="${a.id}">Edit</button>
              <button class="btn small danger" data-delete-app="${a.id}">Remove</button>
            </span>
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
      <div class="thumb-row">
        <div class="thumb-preview" id="thumbPreview">No image</div>
        <label class="thumb-file-label" for="newThumbFile">Choose thumbnail image (optional)</label>
        <input type="file" id="newThumbFile" accept="image/*" style="display:none;">
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

let pendingThumbDataUrl = null;

function resizeImageToDataUrl(file, maxSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1b1e2b'; // flatten transparency onto the tile background color
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderAppEditRow(a) {
  return `
    <div class="admin-row" style="flex-direction:column; align-items:stretch; background:var(--panel-2);" data-editing="${a.id}">
      <div class="form-grid">
        <input id="editIcon" value="${escapeAttr(a.icon || '')}" placeholder="🔗" maxlength="4">
        <input id="editName" value="${escapeAttr(a.name || '')}" placeholder="App name">
        <input id="editUrl" value="${escapeAttr(a.url || '')}" placeholder="App URL (https://...)">
      </div>
      <div class="form-grid" style="grid-template-columns: 1fr;">
        <input id="editDesc" value="${escapeAttr(a.description || '')}" placeholder="Short description (optional)">
      </div>
      <div class="thumb-row">
        <div class="thumb-preview" id="editThumbPreview">${a.thumbnail ? `<img src="${escapeAttr(a.thumbnail)}" alt="">` : 'No image'}</div>
        <label class="thumb-file-label" for="editThumbFile">Change thumbnail image</label>
        <input type="file" id="editThumbFile" accept="image/*" style="display:none;">
      </div>
      <div class="form-actions" style="margin-bottom:4px;">
        <button class="btn primary" id="saveEditBtn">Save changes</button>
        <button class="btn" id="cancelEditBtn">Cancel</button>
      </div>
    </div>
  `;
}

function wireAdminPanel() {
  const thumbFileInput = document.getElementById('newThumbFile');
  if (thumbFileInput) {
    thumbFileInput.onchange = async () => {
      const file = thumbFileInput.files[0];
      if (!file) return;
      const dataUrl = await resizeImageToDataUrl(file, 260);
      if (dataUrl.length > 45000) { toast('Image is too large even after resizing — try a simpler/smaller image'); return; }
      pendingThumbDataUrl = dataUrl;
      document.getElementById('thumbPreview').innerHTML = `<img src="${dataUrl}" alt="">`;
    };
  }

  document.getElementById('addAppBtn').onclick = async () => {
    const name = document.getElementById('newName').value.trim();
    const url = document.getElementById('newUrl').value.trim();
    const icon = document.getElementById('newIcon').value.trim() || '🔗';
    const description = document.getElementById('newDesc').value.trim();
    if (!name || !url) { toast('Name and URL are required'); return; }
    const addBtn = document.getElementById('addAppBtn');
    addBtn.textContent = 'Adding...'; addBtn.disabled = true;
    try {
      // POST (not GET) because an embedded image data URL can be long —
      // too long to safely fit in a URL's query string.
      const data = await apiPost('addApp', { name, url, icon, description, thumbnail: pendingThumbDataUrl || '' });
      if (data.error) { toast('Could not add app: ' + data.error); addBtn.textContent = 'Add app'; addBtn.disabled = false; return; }
      pendingThumbDataUrl = null;
      toast('App added');
      await refreshApps();
    } catch (err) {
      toast('Could not add app');
      addBtn.textContent = 'Add app'; addBtn.disabled = false;
    }
  };

  document.querySelectorAll('[data-delete-app]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Remove this app for everyone?')) return;
      await apiGet('deleteApp', { id: btn.getAttribute('data-delete-app') });
      toast('App removed');
      await refreshApps();
    };
  });

  document.querySelectorAll('[data-edit-app]').forEach(btn => {
    btn.onclick = () => {
      state.editingAppId = btn.getAttribute('data-edit-app');
      pendingEditThumbDataUrl = null;
      renderMain();
    };
  });

  const editThumbFileInput = document.getElementById('editThumbFile');
  if (editThumbFileInput) {
    editThumbFileInput.onchange = async () => {
      const file = editThumbFileInput.files[0];
      if (!file) return;
      const dataUrl = await resizeImageToDataUrl(file, 260);
      if (dataUrl.length > 45000) { toast('Image is too large even after resizing — try a simpler/smaller image'); return; }
      pendingEditThumbDataUrl = dataUrl;
      document.getElementById('editThumbPreview').innerHTML = `<img src="${dataUrl}" alt="">`;
    };
  }
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  if (cancelEditBtn) {
    cancelEditBtn.onclick = () => {
      state.editingAppId = null;
      pendingEditThumbDataUrl = null;
      renderMain();
    };
  }
  const saveEditBtn = document.getElementById('saveEditBtn');
  if (saveEditBtn) {
    saveEditBtn.onclick = async () => {
      const id = state.editingAppId;
      const name = document.getElementById('editName').value.trim();
      const url = document.getElementById('editUrl').value.trim();
      const icon = document.getElementById('editIcon').value.trim() || '🔗';
      const description = document.getElementById('editDesc').value.trim();
      if (!name || !url) { toast('Name and URL are required'); return; }
      saveEditBtn.textContent = 'Saving...'; saveEditBtn.disabled = true;
      try {
        const params = { id, name, url, icon, description };
        if (pendingEditThumbDataUrl) params.thumbnail = pendingEditThumbDataUrl;
        const data = await apiPost('updateApp', params);
        if (data.error) { toast('Could not save: ' + data.error); saveEditBtn.textContent = 'Save changes'; saveEditBtn.disabled = false; return; }
        state.editingAppId = null;
        pendingEditThumbDataUrl = null;
        toast('App updated');
        await refreshApps();
      } catch (err) {
        toast('Could not save changes');
        saveEditBtn.textContent = 'Save changes'; saveEditBtn.disabled = false;
      }
    };
  }

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
  try {
    const data = await apiGet('listApps');
    state.apps = data.apps || [];
  } catch (err) {
    console.error('refreshApps failed:', err);
    toast('Could not refresh app list');
  }
  renderMain();
}
async function refreshUsers() {
  try {
    const data = await apiGet('listUsers');
    state.users = data.users || [];
  } catch (err) {
    console.error('refreshUsers failed:', err);
    toast('Could not refresh member list');
  }
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
