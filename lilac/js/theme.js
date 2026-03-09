// ============================================================
// LILAC - Theme System (Light/Dark Mode)
// ============================================================

function getTheme() {
  try {
    var saved = localStorage.getItem('lilac_theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch(e) {}
  // Check system preference
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function setTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  try {
    localStorage.setItem('lilac_theme', theme);
  } catch(e) {}
  updateThemeToggleIcon(theme);
}

function toggleTheme() {
  var current = getTheme();
  var next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
}

function updateThemeToggleIcon(theme) {
  var btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;
  if (theme === 'dark') {
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  } else {
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }
}

// Apply theme on load
setTheme(getTheme());

// Listen for system theme changes
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
    var saved = localStorage.getItem('lilac_theme');
    if (!saved) {
      setTheme(e.matches ? 'dark' : 'light');
    }
  });
}
