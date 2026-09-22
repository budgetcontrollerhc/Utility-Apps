// ============================================================
// No OAuth Client ID, no Google Cloud Console needed.
// The only setup here is deploying this script (Deploy > New
// deployment > Web app) and pasting the resulting URL into
// app.js. Everything else — apps, members, approvals — is
// managed from inside the app.
// ============================================================

var USERS_HEADERS = ['mobile', 'name', 'salt', 'passwordHash', 'role', 'status']; // status: pending | active
var SESSIONS_HEADERS = ['token', 'mobile', 'expiresAt'];
var APPS_HEADERS = ['id', 'name', 'icon', 'description', 'url'];
var SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function doGet(e) {
  return route_(e);
}
function doPost(e) {
  // Body sent as text/plain (to avoid CORS preflight); parse it as JSON
  // and merge into e.parameter so both verbs share the same handlers.
  if (e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      e.parameter = e.parameter || {};
      for (var k in body) e.parameter[k] = body[k];
    } catch (err) { /* ignore malformed body */ }
  }
  return route_(e);
}

function route_(e) {
  var action = e.parameter.action;
  var output;
  try {
    switch (action) {
      case 'signup': output = handleSignup(e); break;
      case 'login': output = handleLogin(e); break;
      case 'checkSession': output = handleCheckSession(e); break;
      case 'logout': output = handleLogout(e); break;
      case 'listApps': output = withAuth(e, false, function () { return { apps: getApps_() }; }); break;
      case 'addApp': output = withAuth(e, true, function () { return handleAddApp(e); }); break;
      case 'updateApp': output = withAuth(e, true, function () { return handleUpdateApp(e); }); break;
      case 'deleteApp': output = withAuth(e, true, function () { return handleDeleteApp(e); }); break;
      case 'listUsers': output = withAuth(e, true, function () { return { users: getUsers_() }; }); break;
      case 'approveUser': output = withAuth(e, true, function () { return handleApproveUser(e); }); break;
      case 'rejectUser': output = withAuth(e, true, function () { return handleRejectUser(e); }); break;
      case 'removeUser': output = withAuth(e, true, function (mobile) { return handleRemoveUser(e, mobile); }); break;
      case 'setRole': output = withAuth(e, true, function () { return handleSetRole(e); }); break;
      case 'resetPassword': output = withAuth(e, true, function () { return handleResetPassword(e); }); break;
      default: output = { error: 'Unknown action' };
    }
  } catch (err) {
    output = { error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- Password helpers ----------

function normalizeMobile_(m) {
  return String(m || '').replace(/[^0-9+]/g, '');
}

function hashPassword_(password, salt) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + salt);
  return digest.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function makeSalt_() {
  return Utilities.getUuid();
}

// ---------- Signup / Login ----------

function handleSignup(e) {
  var mobile = normalizeMobile_(e.parameter.mobile);
  var name = (e.parameter.name || '').trim();
  var password = String(e.parameter.password || '');
  if (!mobile || mobile.length < 8) return { error: 'Enter a valid mobile number' };
  if (password.length < 6) return { error: 'Password must be at least 6 characters' };

  var sheet = getSheet_('Users', USERS_HEADERS);
  var users = getUsers_();
  if (users.some(function (u) { return u.mobile === mobile; })) {
    return { error: 'An account with this mobile number already exists' };
  }

  var salt = makeSalt_();
  var hash = hashPassword_(password, salt);
  // Bootstrap: the very first account ever created is auto-approved as admin.
  var isFirstEver = users.length === 0;
  sheet.appendRow([mobile, name, salt, hash, isFirstEver ? 'admin' : 'user', isFirstEver ? 'active' : 'pending']);

  if (isFirstEver) {
    return handleLogin(e); // log them straight in
  }
  return { ok: true, pending: true, message: 'Request submitted. An admin needs to approve your account before you can sign in.' };
}

function handleLogin(e) {
  var mobile = normalizeMobile_(e.parameter.mobile);
  var password = String(e.parameter.password || '');
  var users = getUsers_();
  var user = users.filter(function (u) { return u.mobile === mobile; })[0];
  if (!user) return { error: 'No account with that mobile number' };
  if (hashPassword_(password, user.salt) !== user.passwordHash) return { error: 'Incorrect password' };
  if (user.status !== 'active') return { error: 'Your account is still waiting for admin approval' };

  var token = Utilities.getUuid();
  var sessSheet = getSheet_('Sessions', SESSIONS_HEADERS);
  sessSheet.appendRow([token, mobile, Date.now() + SESSION_LIFETIME_MS]);

  return { ok: true, token: token, mobile: mobile, name: user.name, isAdmin: user.role === 'admin', apps: getApps_() };
}

function handleLogout(e) {
  var sheet = getSheet_('Sessions', SESSIONS_HEADERS);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === e.parameter.token) { sheet.deleteRow(i + 1); break; }
  }
  return { ok: true };
}

function handleCheckSession(e) {
  var session = validSession_(e.parameter.token);
  if (!session) return { authorized: false };
  var users = getUsers_();
  var user = users.filter(function (u) { return u.mobile === session.mobile; })[0];
  if (!user || user.status !== 'active') return { authorized: false };
  return { authorized: true, mobile: user.mobile, name: user.name, isAdmin: user.role === 'admin', apps: getApps_() };
}

// ---------- Session-based auth guard ----------

function validSession_(token) {
  if (!token) return null;
  var sheet = getSheet_('Sessions', SESSIONS_HEADERS);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === token) {
      if (Number(values[i][2]) < Date.now()) return null; // expired
      return { mobile: values[i][1] };
    }
  }
  return null;
}

function withAuth(e, requireAdmin, fn) {
  var session = validSession_(e.parameter.token);
  if (!session) return { error: 'Not signed in' };
  var users = getUsers_();
  var user = users.filter(function (u) { return u.mobile === session.mobile; })[0];
  if (!user || user.status !== 'active') return { error: 'Not authorized' };
  if (requireAdmin && user.role !== 'admin') return { error: 'Admin only' };
  return fn(session.mobile);
}

// ---------- Sheet-backed storage ----------

function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (err) { /* recreate below */ }
  }
  var ss = SpreadsheetApp.create('App Launcher Data');
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function getSheet_(name, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function sheetToObjects_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  return values.slice(1).filter(function (row) { return row[0] !== ''; }).map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function getUsers_() { return sheetToObjects_(getSheet_('Users', USERS_HEADERS)); }
function getApps_() {
  return sheetToObjects_(getSheet_('Apps', APPS_HEADERS));
}

// ---------- Admin: user management ----------

function findUserRow_(sheet, mobile) {
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === mobile) return i + 1;
  }
  return -1;
}

function handleApproveUser(e) {
  var sheet = getSheet_('Users', USERS_HEADERS);
  var row = findUserRow_(sheet, normalizeMobile_(e.parameter.mobile));
  if (row === -1) return { error: 'User not found' };
  sheet.getRange(row, 6).setValue('active');
  if (e.parameter.role === 'admin') sheet.getRange(row, 5).setValue('admin');
  return { ok: true, users: getUsers_() };
}

function handleRejectUser(e) {
  var sheet = getSheet_('Users', USERS_HEADERS);
  var row = findUserRow_(sheet, normalizeMobile_(e.parameter.mobile));
  if (row !== -1) sheet.deleteRow(row);
  return { ok: true, users: getUsers_() };
}

function handleRemoveUser(e, actingMobile) {
  var mobile = normalizeMobile_(e.parameter.mobile);
  if (mobile === actingMobile) return { error: "You can't remove yourself" };
  var sheet = getSheet_('Users', USERS_HEADERS);
  var row = findUserRow_(sheet, mobile);
  if (row !== -1) sheet.deleteRow(row);
  return { ok: true, users: getUsers_() };
}

function handleSetRole(e) {
  var sheet = getSheet_('Users', USERS_HEADERS);
  var row = findUserRow_(sheet, normalizeMobile_(e.parameter.mobile));
  if (row === -1) return { error: 'User not found' };
  sheet.getRange(row, 5).setValue(e.parameter.role === 'admin' ? 'admin' : 'user');
  return { ok: true, users: getUsers_() };
}

function handleResetPassword(e) {
  var sheet = getSheet_('Users', USERS_HEADERS);
  var row = findUserRow_(sheet, normalizeMobile_(e.parameter.mobile));
  if (row === -1) return { error: 'User not found' };
  var newPassword = String(e.parameter.newPassword || '');
  if (newPassword.length < 6) return { error: 'Password must be at least 6 characters' };
  var salt = makeSalt_();
  sheet.getRange(row, 3, 1, 2).setValues([[salt, hashPassword_(newPassword, salt)]]);
  return { ok: true };
}

// ---------- App CRUD ----------

function handleAddApp(e) {
  var sheet = getSheet_('Apps', APPS_HEADERS);
  sheet.appendRow([Utilities.getUuid(), e.parameter.name, e.parameter.icon || '🔗', e.parameter.description || '', e.parameter.url]);
  return { ok: true, apps: getApps_() };
}

function handleUpdateApp(e) {
  var sheet = getSheet_('Apps', APPS_HEADERS);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === e.parameter.id) {
      sheet.getRange(i + 1, 1, 1, 5).setValues([[
        e.parameter.id,
        e.parameter.name || values[i][1],
        e.parameter.icon || values[i][2],
        e.parameter.description || values[i][3],
        e.parameter.url || values[i][4]
      ]]);
      break;
    }
  }
  return { ok: true, apps: getApps_() };
}

function handleDeleteApp(e) {
  var sheet = getSheet_('Apps', APPS_HEADERS);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === e.parameter.id) { sheet.deleteRow(i + 1); break; }
  }
  return { ok: true, apps: getApps_() };
}
