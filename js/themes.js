// ============================================================
// LARRY v3.0 -- THEME SYSTEM
// VS Code-inspired color themes
// ============================================================

var THEMES = {
  'larry-dark': {
    id: 'larry-dark',
    name: 'Larry Dark',
    preview: { bg: '#0a0a1a', card: '#12122a', accent: '#3b82f6', text: '#e8e8f0' },
    vars: {
      '--bg-base': '#0a0a1a',
      '--bg-card': '#12122a',
      '--bg-card-alt': '#16162a',
      '--bg-surface': '#1a1a3a',
      '--bg-input': '#16162a',
      '--border': '#2a2a4a',
      '--border-light': '#3a3a5a',
      '--text-primary': '#e8e8f0',
      '--text-secondary': '#8888aa',
      '--text-muted': '#5a5a7a',
      '--accent-blue': '#3b82f6',
      '--accent-green': '#22c55e',
      '--accent-red': '#ef4444',
      '--accent-gold': '#f59e0b',
      '--accent-orange': '#f97316',
      '--accent-cyan': '#06b6d4',
      '--accent-purple': '#a855f7'
    }
  },
  'dark-plus': {
    id: 'dark-plus',
    name: 'Dark+',
    preview: { bg: '#1e1e1e', card: '#252526', accent: '#569cd6', text: '#d4d4d4' },
    vars: {
      '--bg-base': '#1e1e1e',
      '--bg-card': '#252526',
      '--bg-card-alt': '#2d2d2d',
      '--bg-surface': '#333333',
      '--bg-input': '#3c3c3c',
      '--border': '#474747',
      '--border-light': '#555555',
      '--text-primary': '#d4d4d4',
      '--text-secondary': '#9da5b4',
      '--text-muted': '#6a6a6a',
      '--accent-blue': '#569cd6',
      '--accent-green': '#6a9955',
      '--accent-red': '#f44747',
      '--accent-gold': '#dcdcaa',
      '--accent-orange': '#ce9178',
      '--accent-cyan': '#4ec9b0',
      '--accent-purple': '#c586c0'
    }
  },
  'one-dark': {
    id: 'one-dark',
    name: 'One Dark Pro',
    preview: { bg: '#282c34', card: '#21252b', accent: '#61afef', text: '#abb2bf' },
    vars: {
      '--bg-base': '#282c34',
      '--bg-card': '#21252b',
      '--bg-card-alt': '#2c313a',
      '--bg-surface': '#333842',
      '--bg-input': '#1b1d23',
      '--border': '#3e4452',
      '--border-light': '#4b5263',
      '--text-primary': '#abb2bf',
      '--text-secondary': '#7f848e',
      '--text-muted': '#5c6370',
      '--accent-blue': '#61afef',
      '--accent-green': '#98c379',
      '--accent-red': '#e06c75',
      '--accent-gold': '#e5c07b',
      '--accent-orange': '#d19a66',
      '--accent-cyan': '#56b6c2',
      '--accent-purple': '#c678dd'
    }
  },
  'dracula': {
    id: 'dracula',
    name: 'Dracula',
    preview: { bg: '#282a36', card: '#21222c', accent: '#bd93f9', text: '#f8f8f2' },
    vars: {
      '--bg-base': '#282a36',
      '--bg-card': '#21222c',
      '--bg-card-alt': '#343746',
      '--bg-surface': '#44475a',
      '--bg-input': '#191a21',
      '--border': '#44475a',
      '--border-light': '#6272a4',
      '--text-primary': '#f8f8f2',
      '--text-secondary': '#6272a4',
      '--text-muted': '#4a4d5e',
      '--accent-blue': '#8be9fd',
      '--accent-green': '#50fa7b',
      '--accent-red': '#ff5555',
      '--accent-gold': '#f1fa8c',
      '--accent-orange': '#ffb86c',
      '--accent-cyan': '#8be9fd',
      '--accent-purple': '#bd93f9'
    }
  },
  'monokai': {
    id: 'monokai',
    name: 'Monokai',
    preview: { bg: '#272822', card: '#1e1f1c', accent: '#a6e22e', text: '#f8f8f2' },
    vars: {
      '--bg-base': '#272822',
      '--bg-card': '#1e1f1c',
      '--bg-card-alt': '#2e2f2a',
      '--bg-surface': '#3e3d32',
      '--bg-input': '#1e1f1c',
      '--border': '#414339',
      '--border-light': '#525345',
      '--text-primary': '#f8f8f2',
      '--text-secondary': '#a6a28c',
      '--text-muted': '#75715e',
      '--accent-blue': '#66d9ef',
      '--accent-green': '#a6e22e',
      '--accent-red': '#f92672',
      '--accent-gold': '#e6db74',
      '--accent-orange': '#fd971f',
      '--accent-cyan': '#66d9ef',
      '--accent-purple': '#ae81ff'
    }
  },
  'solarized-dark': {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    preview: { bg: '#002b36', card: '#00212b', accent: '#268bd2', text: '#839496' },
    vars: {
      '--bg-base': '#002b36',
      '--bg-card': '#00212b',
      '--bg-card-alt': '#073642',
      '--bg-surface': '#073642',
      '--bg-input': '#002b36',
      '--border': '#586e75',
      '--border-light': '#657b83',
      '--text-primary': '#839496',
      '--text-secondary': '#657b83',
      '--text-muted': '#586e75',
      '--accent-blue': '#268bd2',
      '--accent-green': '#859900',
      '--accent-red': '#dc322f',
      '--accent-gold': '#b58900',
      '--accent-orange': '#cb4b16',
      '--accent-cyan': '#2aa198',
      '--accent-purple': '#d33682'
    }
  },
  'github-dark': {
    id: 'github-dark',
    name: 'GitHub Dark',
    preview: { bg: '#0d1117', card: '#161b22', accent: '#58a6ff', text: '#c9d1d9' },
    vars: {
      '--bg-base': '#0d1117',
      '--bg-card': '#161b22',
      '--bg-card-alt': '#1c2128',
      '--bg-surface': '#21262d',
      '--bg-input': '#0d1117',
      '--border': '#30363d',
      '--border-light': '#484f58',
      '--text-primary': '#c9d1d9',
      '--text-secondary': '#8b949e',
      '--text-muted': '#6e7681',
      '--accent-blue': '#58a6ff',
      '--accent-green': '#3fb950',
      '--accent-red': '#f85149',
      '--accent-gold': '#d29922',
      '--accent-orange': '#db6d28',
      '--accent-cyan': '#39d2c0',
      '--accent-purple': '#bc8cff'
    }
  },
  'nord': {
    id: 'nord',
    name: 'Nord',
    preview: { bg: '#2e3440', card: '#3b4252', accent: '#88c0d0', text: '#d8dee9' },
    vars: {
      '--bg-base': '#2e3440',
      '--bg-card': '#3b4252',
      '--bg-card-alt': '#434c5e',
      '--bg-surface': '#4c566a',
      '--bg-input': '#3b4252',
      '--border': '#4c566a',
      '--border-light': '#616e88',
      '--text-primary': '#d8dee9',
      '--text-secondary': '#81a1c1',
      '--text-muted': '#4c566a',
      '--accent-blue': '#81a1c1',
      '--accent-green': '#a3be8c',
      '--accent-red': '#bf616a',
      '--accent-gold': '#ebcb8b',
      '--accent-orange': '#d08770',
      '--accent-cyan': '#88c0d0',
      '--accent-purple': '#b48ead'
    }
  },
  'catppuccin': {
    id: 'catppuccin',
    name: 'Catppuccin Mocha',
    preview: { bg: '#1e1e2e', card: '#181825', accent: '#89b4fa', text: '#cdd6f4' },
    vars: {
      '--bg-base': '#1e1e2e',
      '--bg-card': '#181825',
      '--bg-card-alt': '#313244',
      '--bg-surface': '#313244',
      '--bg-input': '#181825',
      '--border': '#45475a',
      '--border-light': '#585b70',
      '--text-primary': '#cdd6f4',
      '--text-secondary': '#a6adc8',
      '--text-muted': '#6c7086',
      '--accent-blue': '#89b4fa',
      '--accent-green': '#a6e3a1',
      '--accent-red': '#f38ba8',
      '--accent-gold': '#f9e2af',
      '--accent-orange': '#fab387',
      '--accent-cyan': '#94e2d5',
      '--accent-purple': '#cba6f7'
    }
  }
};

// --- THEME APPLICATION ---
function applyTheme(themeId) {
  var theme = THEMES[themeId];
  if (!theme) theme = THEMES['larry-dark'];
  var root = document.documentElement;
  Object.keys(theme.vars).forEach(function(prop) {
    root.style.setProperty(prop, theme.vars[prop]);
  });
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.vars['--bg-base']);
}

function getCurrentThemeId() {
  try {
    var raw = localStorage.getItem('larry_theme');
    if (raw && THEMES[raw]) return raw;
  } catch(e) {}
  return 'larry-dark';
}

function setTheme(themeId) {
  if (!THEMES[themeId]) themeId = 'larry-dark';
  localStorage.setItem('larry_theme', themeId);
  if (typeof S !== 'undefined' && S && S.prefs) S.prefs.theme = themeId;
  applyTheme(themeId);
}

// --- THEME PICKER UI ---
function renderThemePicker(selectedId) {
  selectedId = selectedId || getCurrentThemeId();
  var html = '<div class="theme-grid">';
  Object.keys(THEMES).forEach(function(id) {
    var t = THEMES[id];
    var isActive = id === selectedId;
    html += '<button class="theme-card' + (isActive ? ' active' : '') + '" onclick="setTheme(\'' + id + '\');render()">';
    html += '<div class="theme-preview" style="background:' + t.preview.bg + ';border:1px solid ' + (isActive ? t.preview.accent : 'rgba(255,255,255,0.1)') + '">';
    html += '<div class="theme-preview-bar" style="background:' + t.preview.card + '">';
    html += '<span class="theme-preview-dot" style="background:' + t.preview.accent + '"></span>';
    html += '<span class="theme-preview-text" style="color:' + t.preview.text + '">Aa</span>';
    html += '</div></div>';
    html += '<span class="theme-card-name">' + t.name + '</span>';
    if (isActive) html += '<span class="theme-check">&#10003;</span>';
    html += '</button>';
  });
  html += '</div>';
  return html;
}

// Apply theme immediately on script load to prevent flash
applyTheme(getCurrentThemeId());
