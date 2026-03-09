// ============================================================
// LILAC - Simple Auth (Name-based user selection)
// ============================================================

// Default users - can be customized
var LILAC_USERS = [
  { name: 'User 1', initial: 'U' },
  { name: 'User 2', initial: 'U' }
];

function getCurrentUser() {
  try {
    return localStorage.getItem('lilac_user');
  } catch(e) {}
  return null;
}

function setCurrentUser(name) {
  try {
    localStorage.setItem('lilac_user', name);
  } catch(e) {}
}

function getUserInitial(name) {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

function showAuthScreen() {
  var screen = document.getElementById('auth-screen');
  var container = document.getElementById('auth-users');
  screen.classList.remove('hidden');

  var html = '';
  LILAC_USERS.forEach(function(user) {
    html += '<button class="auth-user-btn" onclick="selectUser(\'' + user.name.replace(/'/g, "\\'") + '\')">';
    html += '<span class="auth-user-avatar">' + getUserInitial(user.name) + '</span>';
    html += '<span>' + user.name + '</span>';
    html += '</button>';
  });
  container.innerHTML = html;
}

function selectUser(name) {
  setCurrentUser(name);
  document.getElementById('auth-screen').classList.add('hidden');
  updateUserAvatar(name);
  initApp();
}

function updateUserAvatar(name) {
  var btn = document.getElementById('user-avatar-btn');
  if (btn) {
    btn.textContent = getUserInitial(name);
  }
}

function switchUser() {
  try {
    localStorage.removeItem('lilac_user');
  } catch(e) {}
  showAuthScreen();
}

function showUserMenu() {
  var overlay = document.getElementById('user-menu-overlay');
  var content = document.getElementById('user-menu-content');
  var user = getCurrentUser();

  var html = '<div class="user-menu-content">';
  html += '<div class="user-info">';
  html += '<div class="user-info-avatar">' + getUserInitial(user) + '</div>';
  html += '<div><div class="user-info-name">' + (user || 'Guest') + '</div>';
  html += '<div class="text-muted" style="font-size:0.8125rem">Logged in</div></div>';
  html += '</div>';
  html += '<button class="user-menu-item" onclick="toggleTheme();closeUserMenu()">';
  html += '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  html += 'Toggle Dark Mode</button>';
  html += '<button class="user-menu-item danger" onclick="switchUser();closeUserMenu()">';
  html += '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
  html += 'Switch User</button>';
  html += '</div>';

  content.innerHTML = html;
  overlay.classList.remove('hidden');
}

function closeUserMenu() {
  document.getElementById('user-menu-overlay').classList.add('hidden');
}
