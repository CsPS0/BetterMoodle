// ==========================================================================
// BetterMoodle - Universal Core Engine & Shadow DOM Shell
// ==========================================================================

(() => {
  'use strict';

  if (typeof window.__mpCleanup === 'function') {
    try { window.__mpCleanup(); } catch (_) {}
  }

  // Only activate on actual Moodle instances
  function isMoodlePage() {
    try {
      if (window.M && window.M.cfg) return true;
    } catch (_) {}

    return Boolean(
      document.querySelector(
        'meta[name="keywords"][content*="moodle" i], ' +
        'body[id^="page-"][class*="path-"], ' +
        'body.pagelayout-login, ' +
        'form#login[action*="/login/index.php"], ' +
        'form[action*="/login/logout.php"], ' +
        'script[src*="/lib/javascript.php"], ' +
        'script[src*="/lib/requirejs.php"], ' +
        'link[href*="/theme/styles.php"]'
      )
    );
  }

  if (!isMoodlePage()) {
    return;
  }

  const STORAGE_KEY = 'bm_moodle_settings';

  const DEFAULT_STATE = {
    overhaulMode: true,
    uiScheme: 'auto',    // 'auto' | 'dark' | 'light'
    uiScale: 100,        // 85..125 (%)
    theme: 'midnight',   // 'midnight' | 'oled' | 'catppuccin' | 'light'
    customAccent: '',
    customBg: '',
    wallpaperUrl: '',
    navStyle: 'sidebar', // 'sidebar' | 'topbar'
    courseNavStyle: 'icons', // 'icons' | 'both' | 'text'
    courseNavBg: '',     // custom hex background color for course secondary nav
    viewMode: 'grid',    // 'grid' | 'compact'
    cardRadius: 8,
    density: 'normal',   // 'normal' | 'compact'
    autoUnwrap: true,
    hideCompletion: false,
    pinnedCourses: [],
    cachedCourses: [],
    cachedDeadlines: [],
    lastMoodleOrigin: '',
    lastMoodleWwwroot: '',
    lastMoodleTitle: ''
  };

  let state = { ...DEFAULT_STATE };
  let activeCourseFilter = 'all';
  let activeCalendarView = 'month'; // 'month' | 'week' | 'day'
  let activeCalendarDate = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 12, 0, 0);
  const calendarMonthCache = new Map();
  const calendarInFlightKeys = new Set();
  let cachedSesskey = null;
  let shadowRoot = null;
  let currentCinemaMedia = null;
  let unwrappedMediaMap = new Map();

  const hasChromeStorage = Boolean(
    typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local
  );

  // Moodle can be installed under a sub-path (https://host/moodle/). Resolve the
  // real wwwroot from the inline M.cfg JSON or core asset URLs; never assume "/".
  let cachedWwwroot = '';
  function getWwwroot() {
    if (cachedWwwroot) return cachedWwwroot;
    let root = '';
    for (const sc of document.querySelectorAll('script:not([src])')) {
      const m = (sc.textContent || '').match(/"wwwroot"\s*:\s*"([^"]+)"/);
      if (m) {
        root = m[1].replace(/\\\//g, '/');
        break;
      }
    }
    if (!root) {
      const asset = document.querySelector('link[href*="/theme/styles.php"], script[src*="/lib/javascript.php"], script[src*="/lib/requirejs.php"]');
      const url = asset?.href || asset?.src || '';
      const m = url.match(/^(.*?)\/(?:theme\/styles\.php|lib\/javascript\.php|lib\/requirejs\.php)/);
      if (m) root = m[1];
    }
    try {
      const parsed = new URL(root || window.location.origin);
      root = parsed.origin === window.location.origin
        ? `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '')
        : window.location.origin;
    } catch (_) {
      root = window.location.origin;
    }
    cachedWwwroot = root;
    return cachedWwwroot;
  }

  function moodleUrl(path) {
    return `${getWwwroot()}${path}`;
  }

  function getCurrentCourseId() {
    const m = (document.body?.className || '').match(/(?:^|\s)course-(\d+)(?:\s|$)/);
    if (m && m[1] !== '1') return m[1];
    if (/\/course\/view\.php$/.test(window.location.pathname)) {
      return new URLSearchParams(window.location.search).get('id') || '';
    }
    return '';
  }

  function getMoodleSiteLabel() {
    const brandText = document.querySelector('.navbar-brand .site-name, .navbar-brand, #page-header h1')?.textContent?.replace(/\s+/g, ' ').trim();
    if (brandText && brandText.length >= 2 && brandText.length <= 64) {
      return brandText;
    }
    const parts = (document.title || '').split('|');
    if (parts.length > 1) {
      const last = parts[parts.length - 1].trim();
      if (last && last.length <= 64) return last;
    }
    return window.location.hostname || 'Moodle';
  }

  function isLoginRoute() {
    const path = window.location.pathname;
    const body = document.body;
    return (
      path.includes('/login/') ||
      body.classList.contains('path-login') ||
      body.classList.contains('pagelayout-login') ||
      Boolean(document.querySelector('form#login, form[action*="/login/logout.php"]'))
    );
  }

  function getLogoutUrl() {
    const domLogout = document.querySelector('a[href*="/login/logout.php"]');
    if (domLogout && domLogout.href) {
      return domLogout.href;
    }
    const sesskey = getSesskey();
    return `${getWwwroot()}/login/logout.php${sesskey ? `?sesskey=${encodeURIComponent(sesskey)}` : ''}`;
  }

  function performSignOut() {
    window.location.assign(getLogoutUrl());
  }

  // --------------------------------------------------------------------------
  // 0. Crisp 1.5px Stroke SVG Icon Library & Custom Brand Mark
  // --------------------------------------------------------------------------
  function svgLogoMark(size = 16) {
    return `<svg width="${size}" height="${size}" viewBox="16 24 100 82" fill="none" aria-hidden="true"><path d="M 26 80 V 38 L 50 62 L 74 38 V 80" stroke="currentColor" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" /><path d="M 97 34 V 56 M 86 45 H 108" stroke="var(--mp-accent, var(--accent, #3b82f6))" stroke-width="10" stroke-linecap="round" /><path d="M 26 97 H 102" stroke="var(--mp-accent, var(--accent, #3b82f6))" stroke-width="6" stroke-linecap="round" /></svg>`;
  }

  function svgIcon(name, size = 14) {
    const attrs = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
    const paths = {
      bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />',
      sliders: '<line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />',
      book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />',
      grades: '<line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /><line x1="2" y1="20" x2="22" y2="20" />',
      activities: '<polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 12 12 17 22 12" /><polyline points="2 17 12 22 22 17" />',
      competencies: '<circle cx="12" cy="8" r="6" /><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />',
      compass: '<circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />',
      cat: '<path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3.1-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z" /><path d="M8 14v.5" /><path d="M16 14v.5" /><path d="M11.25 16.25h1.5L12 17l-.75-.75Z" />',
      palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />',
      eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />',
      search: '<circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />',
      star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />',
      'star-filled': '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor" />',
      clock: '<circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />',
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />',
      upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />',
      download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />',
      folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />',
      video: '<polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />',
      file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" />',
      play: '<polygon points="5 3 19 12 5 21 5 3" />',
      square: '<rect x="5" y="5" width="14" height="14" rx="2" />',
      tv: '<rect x="2" y="7" width="20" height="15" rx="2" ry="2" /><polyline points="17 2 12 7 7 2" />',
      archive: '<polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />',
      copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />',
      map: '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />',
      grid: '<rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />',
      list: '<line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />',
      menu: '<line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />',
      x: '<line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />',
      'arrow-left': '<line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />',
      'arrow-right': '<line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />',
      'external-link': '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />',
      'chevron-left': '<polyline points="15 18 9 12 15 6" />',
      'chevron-right': '<polyline points="9 18 15 12 9 6" />',
      'chevron-down': '<polyline points="6 9 12 15 18 9" />',
      'chevron-up': '<polyline points="18 15 12 9 6 15" />',
      terminal: '<polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />',
      check: '<polyline points="20 6 9 17 4 12" />',
      'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />',
      'zoom-in': '<circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />',
      'zoom-out': '<circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />',
      'alert-circle': '<circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />'
    };
    return `<svg ${attrs}>${paths[name] || paths.bolt}</svg>`;
  }

  // --------------------------------------------------------------------------
  // 1. Storage Abstraction (chrome.storage.local + localStorage fallback)
  // --------------------------------------------------------------------------
  function loadState() {
    return new Promise((resolve) => {
      let localFallback = {};
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) localFallback = JSON.parse(raw);
      } catch (_) {}

      if (hasChromeStorage) {
        chrome.storage.local.get(DEFAULT_STATE, (items) => {
          state = { ...DEFAULT_STATE, ...localFallback, ...items };
          resolve(state);
        });
      } else {
        state = { ...DEFAULT_STATE, ...localFallback };
        resolve(state);
      }
    });
  }

  function saveState(patch) {
    Object.assign(state, patch);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}

    if (hasChromeStorage) {
      chrome.storage.local.set(patch);
    }
  }

  if (hasChromeStorage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      let changedVisual = false;
      let changedDash = false;
      for (const [k, ch] of Object.entries(changes)) {
        state[k] = ch.newValue;
        if ([
          'overhaulMode', 'uiScheme', 'uiScale', 'theme', 'customAccent', 'customBg',
          'wallpaperUrl', 'navStyle', 'courseNavStyle', 'courseNavBg',
          'cardRadius', 'density', 'hideCompletion'
        ].includes(k)) {
          changedVisual = true;
        }
        if (['viewMode', 'pinnedCourses', 'overhaulMode', 'cachedDeadlines'].includes(k)) {
          changedDash = true;
        }
      }
      if (changedVisual) {
        applyVisualSettings();
        syncShadowControls();
      }
      if (changedDash) {
        renderSidebarCourses();
        renderDashboardHub();
      }
    });
  }

  // --------------------------------------------------------------------------
  // 2. Visual Theme & UI Scale Engine
  // --------------------------------------------------------------------------
  function normalizeTheme(t) {
    return ['midnight', 'oled', 'catppuccin', 'light'].includes(t) ? t : 'midnight';
  }

  function clampUiScale(val) {
    const n = Number(val);
    if (!Number.isFinite(n)) return 100;
    return Math.min(125, Math.max(85, Math.round(n)));
  }

  function isHexColor(str) {
    return /^#[0-9a-fA-F]{6}$/.test(String(str || '').trim());
  }

  // WCAG relative luminance: pick near-black or white text for a fill colour
  function readableOn(hex) {
    const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    return (1.05 / (lum + 0.05)) >= ((lum + 0.05) / 0.0527) ? '#ffffff' : '#09090b';
  }

  // Current preset token as #rrggbb, so colour pickers start from the active
  // theme (e.g. white canvas on Clean Light) instead of a hardcoded dark value.
  function themeHex(token, fallback) {
    const val = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    return isHexColor(val) ? val : fallback;
  }

  function sanitizeWallpaperUrl(raw) {
    const str = String(raw || '').trim();
    if (!str) return '';
    try {
      const u = new URL(str, window.location.href);
      if (!['https:', 'http:'].includes(u.protocol)) return '';
      return u.href.replace(/["\\\n\r()]/g, (ch) => encodeURIComponent(ch));
    } catch (_) {
      return '';
    }
  }

  // Dark-mode extensions (Dark Reader) re-colour pages and rewrite CSS custom
  // properties, which fights the BetterMoodle themes (grey page bands, muddy
  // tables, transparent shadow panels). The overhaul already provides a full
  // theme, so declare the page as themed while it is active.
  function syncDarkReaderLock(locked) {
    const existing = document.querySelector('meta[name="darkreader-lock"][data-mp-owned="true"]');
    if (locked && !existing && document.head) {
      const meta = document.createElement('meta');
      meta.name = 'darkreader-lock';
      meta.setAttribute('data-mp-owned', 'true');
      document.head.appendChild(meta);
    } else if (!locked && existing) {
      existing.remove();
    }
  }

  function applyVisualSettings() {
    const html = document.documentElement;
    const body = document.body;
    const activeTheme = normalizeTheme(state.theme);
    const uiScale = clampUiScale(state.uiScale);
    const courseNavStyle = ['icons', 'both', 'text'].includes(state.courseNavStyle) ? state.courseNavStyle : 'icons';

    html.setAttribute('data-mp-active', 'true');
    html.setAttribute('data-mp-theme', activeTheme);
    body.classList.toggle('mp-overhaul-active', Boolean(state.overhaulMode));
    syncDarkReaderLock(Boolean(state.overhaulMode));
    body.setAttribute('data-mp-nav', state.navStyle || 'sidebar');
    body.setAttribute('data-mp-density', state.density || 'normal');
    body.setAttribute('data-mp-hide-completion', String(Boolean(state.hideCompletion)));
    body.setAttribute('data-mp-course-nav', courseNavStyle);

    const clampedRadius = Math.min(16, Math.max(0, Number(state.cardRadius ?? 8)));
    html.style.setProperty('--mp-radius', `${clampedRadius}px`);
    html.style.setProperty('--mp-radius-inner', `${Math.max(0, clampedRadius - 4)}px`);
    html.style.setProperty('--mp-ui-scale', String(uiScale / 100));
    html.setAttribute('data-mp-scaled', String(uiScale !== 100));

    if (isHexColor(state.customAccent)) {
      html.style.setProperty('--mp-accent', state.customAccent);
      html.style.setProperty('--accent', state.customAccent);
      // Text on accent fills must stay readable for any picked colour
      html.style.setProperty('--accent-fg', readableOn(state.customAccent));
      html.style.setProperty('--mp-accent-fill', state.customAccent);
    } else {
      html.style.removeProperty('--mp-accent');
      html.style.removeProperty('--accent');
      html.style.removeProperty('--accent-fg');
      html.style.removeProperty('--mp-accent-fill');
    }

    if (state.customBg) {
      html.style.setProperty('--mp-bg', state.customBg);
      html.style.setProperty('--bg-canvas', state.customBg);
    } else {
      html.style.removeProperty('--mp-bg');
      html.style.removeProperty('--bg-canvas');
    }

    if (isHexColor(state.courseNavBg)) {
      html.style.setProperty('--mp-course-nav-bg', state.courseNavBg.trim());
    } else {
      html.style.removeProperty('--mp-course-nav-bg');
    }

    const wallpaper = sanitizeWallpaperUrl(state.wallpaperUrl);
    if (state.overhaulMode && wallpaper) {
      body.classList.add('mp-has-wallpaper');
      body.style.setProperty(
        'background-image',
        `linear-gradient(var(--mp-wallpaper-scrim), var(--mp-wallpaper-scrim)), url("${wallpaper}")`,
        'important'
      );
    } else {
      body.classList.remove('mp-has-wallpaper');
      body.style.removeProperty('background-image');
    }

    const shellIds = ['mp-sidebar', 'mp-mobile-topbar', 'mp-overhaul-dashboard', 'mp-course-hero', 'mp-module-header', 'mp-cinema-header', 'mp-cinema-mobile-bar', 'mp-login-header'];
    shellIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('mp-hidden', !state.overhaulMode);
    });

    const host = document.getElementById('mp-shadow-host');
    if (host) applyShadowHostScheme(host);
    if (triggerHost) applyShadowHostScheme(triggerHost);

    if (state.overhaulMode) {
      enhanceCourseSecondaryNav();
    }
    syncTopRightTriggerPosition();
    queueTriggerSync();
  }

  // Shadow UI follows the page preset (accent, surfaces) unless the user forces
  // a dark/light extension scheme; native controls follow via color-scheme.
  function applyShadowHostScheme(host) {
    const explicit = state.uiScheme === 'light' || state.uiScheme === 'dark' ? state.uiScheme : '';
    if (explicit) {
      host.setAttribute('data-ui-scheme', explicit);
    } else {
      host.removeAttribute('data-ui-scheme');
    }
    const effective = explicit || (normalizeTheme(state.theme) === 'light' ? 'light' : 'dark');
    host.style.setProperty('color-scheme', effective);
    pinShadowPalette(host, explicit, effective);
  }

  // Resolved palette written straight onto a shadow host. Shadow UI must never
  // depend on custom properties inheriting from <html> (some Moodle pages / other
  // extensions break that and the drawer turned transparent). Page preset values
  // win; built-in palettes fill gaps and supply an explicitly forced scheme.
  const SHADOW_PALETTES = {
    dark: {
      '--bg-canvas': '#09090b', '--bg-surface': '#121215', '--bg-elevated': '#18181c', '--bg-hover': '#222228',
      '--text-primary': '#f4f4f5', '--text-secondary': '#a1a1aa', '--text-muted': '#71717a',
      '--border-subtle': 'rgba(255, 255, 255, 0.08)', '--border-strong': 'rgba(255, 255, 255, 0.16)',
      '--success': '#10b981', '--danger': '#ef4444'
    },
    light: {
      '--bg-canvas': '#f4f4f5', '--bg-surface': '#ffffff', '--bg-elevated': '#f8f8fa', '--bg-hover': '#efeff2',
      '--text-primary': '#18181b', '--text-secondary': '#52525b', '--text-muted': '#71717a',
      '--border-subtle': '#e4e4e7', '--border-strong': '#d4d4d8',
      '--success': '#047857', '--danger': '#dc2626'
    }
  };
  const SHADOW_ACCENT_TOKENS = {
    '--accent': '#3b82f6', '--accent-fg': '#ffffff', '--mp-accent-fill': '#2563eb',
    '--success-solid': '#047857', '--success-solid-fg': '#ffffff', '--mp-radius-inner': '4px'
  };

  function pinShadowPalette(host, explicit, effective) {
    if (!host) return;
    const page = getComputedStyle(document.documentElement);
    const palette = SHADOW_PALETTES[effective] || SHADOW_PALETTES.dark;
    Object.entries(palette).forEach(([token, fallback]) => {
      const pageVal = page.getPropertyValue(token).trim();
      host.style.setProperty(token, explicit ? fallback : (pageVal || fallback));
    });
    Object.entries(SHADOW_ACCENT_TOKENS).forEach(([token, fallback]) => {
      host.style.setProperty(token, page.getPropertyValue(token).trim() || fallback);
    });
  }

  function classifyCourseNavItem(link, li) {
    const key = (li?.dataset?.key || '').toLowerCase();
    const href = (link.getAttribute('href') || '').toLowerCase();
    const label = (link.dataset.mpLabel || link.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();

    if (key === 'coursehome' || href.includes('/course/view.php') || /^(kurzus|course|főoldal)$/i.test(label)) {
      return { icon: 'book', key: 'coursehome' };
    }
    if (key === 'participants' || href.includes('/user/index.php') || label.includes('résztvev') || label.includes('participant')) {
      return { icon: 'users', key: 'participants' };
    }
    if (key === 'grades' || href.includes('/grade/report/') || label.includes('értékelés') || label.includes('grade')) {
      return { icon: 'grades', key: 'grades' };
    }
    if (key === 'activities' || href.includes('/course/overview.php') || href.includes('/course/resources.php') || label.includes('tevékenység') || label.includes('activit')) {
      return { icon: 'activities', key: 'activities' };
    }
    if (key === 'competencies' || href.includes('coursecompetencies.php') || href.includes('/admin/tool/lp/') || label.includes('készség') || label.includes('kompetenc') || label.includes('competenc')) {
      return { icon: 'competencies', key: 'competencies' };
    }
    if (key === 'badges' || href.includes('/badges/') || label.includes('jelvény') || label.includes('badge')) {
      return { icon: 'star', key: 'badges' };
    }
    if (key === 'editsettings' || href.includes('/course/edit.php') || label.includes('beállítás') || label.includes('setting')) {
      return { icon: 'sliders', key: 'settings' };
    }
    return { icon: 'compass', key: 'other' };
  }

  function enhanceCourseSecondaryNav() {
    document.querySelectorAll('.secondary-navigation').forEach((nav) => {
      nav.setAttribute('data-mp-cnav-enhanced', 'true');
      nav.querySelectorAll('.nav-tabs a.nav-link:not(.dropdown-toggle), .more-nav a.nav-link:not(.dropdown-toggle), ul.nav a.nav-link:not(.dropdown-toggle)').forEach((link) => {
        const rawText = (link.dataset.mpLabel || link.textContent || '').replace(/\s+/g, ' ').trim();
        if (!rawText) return;
        if (!link.dataset.mpLabel) {
          link.dataset.mpLabel = rawText;
        }
        const label = link.dataset.mpLabel;
        const info = classifyCourseNavItem(link, link.closest('li'));
        link.dataset.mpNavKey = info.key;
        link.title = label;
        link.setAttribute('aria-label', label);

        if (!link.querySelector('.mp-cnav-icon')) {
          link.innerHTML = `<span class="mp-cnav-icon" aria-hidden="true">${svgIcon(info.icon, 16)}</span><span class="mp-cnav-text">${escapeHtml(label)}</span>`;
        }
      });
    });
  }

  // The customize trigger lives in its own small Shadow DOM host. On overhauled
  // pages it is mounted in-flow at the end of the header row of the current view
  // (dashboard right column, course secondary nav, course/module hero, cinema
  // header or mobile topbar), so it scales, scrolls and wraps with that row.
  // Only the login page and the classic Moodle view use a fixed corner slot.
  let triggerHost = null;
  let triggerSyncQueued = false;

  function ensureTriggerHost() {
    if (triggerHost) return triggerHost;
    triggerHost = document.createElement('span');
    triggerHost.id = 'mp-trigger-host';
    const root = triggerHost.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          display: inline-flex;
        }
        button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          height: 30px;
          padding: 0 11px;
          border-radius: var(--mp-radius-inner, 4px);
          border: 1px solid var(--mp-accent-fill, var(--accent, #2563eb));
          background: var(--mp-accent-fill, var(--accent, #2563eb));
          color: var(--accent-fg, #ffffff);
          font-family: inherit;
          font-size: 12px;
          font-weight: 600;
          line-height: 1;
          white-space: nowrap;
          cursor: pointer;
          transition: filter 120ms ease-out, transform 60ms ease-out;
        }
        button:hover { filter: brightness(1.08); }
        button:active { transform: scale(0.97); }
        button:focus-visible { outline: 2px solid var(--accent, #3b82f6); outline-offset: 2px; }
        :host([data-slot="fixed"]) button { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.24); }
      </style>
      <button type="button" id="mp-top-cust-btn" title="Megjelenés testreszabása (Alt+Shift+K)" aria-label="Testreszabás" aria-expanded="false">
        ${svgIcon('sliders', 13)}
        <span>Testreszabás</span>
      </button>
    `;
    root.getElementById('mp-top-cust-btn').addEventListener('click', () => toggleCustomizer());
    applyShadowHostScheme(triggerHost);
    return triggerHost;
  }

  function isRenderedElement(el) {
    return Boolean(el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none');
  }

  function findTriggerSlot() {
    if (!state.overhaulMode || isLoginRoute()) return null;
    const topbar = document.getElementById('mp-mobile-topbar');
    if (isRenderedElement(topbar)) return topbar.querySelector('.mp-topbar-links') || topbar;
    const candidates = [
      document.getElementById('mp-cinema-header'),
      document.getElementById('mp-dash-right-top'),
      document.querySelector('.secondary-navigation'),
      document.querySelector('#mp-course-hero .mp-course-hero-top'),
      document.querySelector('#mp-module-header .mp-course-hero-top'),
      // Pages without a course nav row (calendar, profile, reports): header card
      document.getElementById('page-header')
    ];
    return candidates.find(isRenderedElement) || null;
  }

  function syncTopRightTriggerPosition() {
    const host = ensureTriggerHost();
    const slot = findTriggerSlot();
    const bar = shadowRoot?.getElementById('mp-top-right-bar');

    if (slot) {
      if (host.parentNode !== slot) slot.appendChild(host);
      host.removeAttribute('data-slot');
      bar?.removeAttribute('data-slot');
      return;
    }

    if (!bar) return;
    if (host.parentNode !== bar) bar.appendChild(host);
    host.setAttribute('data-slot', 'fixed');
    bar.setAttribute('data-slot', isLoginRoute() ? 'top-right' : (state.overhaulMode ? 'bottom-right' : 'bottom-left'));
  }

  function queueTriggerSync() {
    if (triggerSyncQueued) return;
    triggerSyncQueued = true;
    requestAnimationFrame(() => {
      triggerSyncQueued = false;
      syncTopRightTriggerPosition();
    });
  }

  function syncShadowControls() {
    if (!shadowRoot) return;
    const schemeSel = shadowRoot.getElementById('mp-cust-uischeme');
    if (schemeSel) schemeSel.value = state.uiScheme || 'auto';

    const navSel = shadowRoot.getElementById('mp-cust-nav');
    if (navSel) navSel.value = state.navStyle || 'sidebar';

    const densitySel = shadowRoot.getElementById('mp-cust-density');
    if (densitySel) densitySel.value = state.density || 'normal';

    const courseNavStyle = ['icons', 'both', 'text'].includes(state.courseNavStyle) ? state.courseNavStyle : 'icons';
    shadowRoot.querySelectorAll('.mp-cnav-seg-btn').forEach((btn) => {
      const active = btn.dataset.cnavStyle === courseNavStyle;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    const cnavPicker = shadowRoot.getElementById('mp-cust-cnav-bg');
    const cnavHex = shadowRoot.getElementById('mp-cust-cnav-bg-hex');
    if (cnavPicker) cnavPicker.value = isHexColor(state.courseNavBg) ? state.courseNavBg : themeHex('--bg-surface', '#121215');
    if (cnavHex) cnavHex.value = state.courseNavBg || '';

    const accentPicker = shadowRoot.getElementById('mp-cust-accent');
    if (accentPicker) accentPicker.value = isHexColor(state.customAccent) ? state.customAccent : themeHex('--accent', '#3b82f6');
    const bgPicker = shadowRoot.getElementById('mp-cust-bg');
    if (bgPicker) bgPicker.value = isHexColor(state.customBg) ? state.customBg : themeHex('--bg-canvas', '#09090b');

    const overhaulCb = shadowRoot.getElementById('mp-cust-overhaul');
    if (overhaulCb) overhaulCb.checked = Boolean(state.overhaulMode);

    const unwrapCb = shadowRoot.getElementById('mp-cust-unwrap');
    if (unwrapCb) unwrapCb.checked = Boolean(state.autoUnwrap);

    const hideCompCb = shadowRoot.getElementById('mp-cust-hidecomp');
    if (hideCompCb) hideCompCb.checked = Boolean(state.hideCompletion);

    const scale = clampUiScale(state.uiScale);
    const scaleInput = shadowRoot.getElementById('mp-cust-scale');
    const scaleVal = shadowRoot.getElementById('mp-scale-val');
    if (scaleInput) scaleInput.value = String(scale);
    if (scaleVal) scaleVal.textContent = `${scale}%`;

    const radiusInput = shadowRoot.getElementById('mp-cust-radius');
    const radiusVal = shadowRoot.getElementById('mp-radius-val');
    if (radiusInput && radiusVal) {
      const r = Math.min(16, Math.max(0, Number(state.cardRadius ?? 8)));
      radiusInput.value = String(r);
      radiusVal.textContent = String(r);
    }

    const activeTheme = normalizeTheme(state.theme);
    shadowRoot.querySelectorAll('.mp-theme-card').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.themeId === activeTheme);
    });
  }

  // --------------------------------------------------------------------------
  // 3. Moodle AJAX Data Fetcher (Courses & Deadlines)
  // --------------------------------------------------------------------------
  function getSesskey() {
    if (cachedSesskey) return cachedSesskey;
    try {
      if (window.M && window.M.cfg && window.M.cfg.sesskey) {
        cachedSesskey = window.M.cfg.sesskey;
        return cachedSesskey;
      }
    } catch (_) {}

    const inp = document.querySelector('input[name="sesskey"]');
    if (inp && inp.value) {
      cachedSesskey = inp.value;
      return cachedSesskey;
    }

    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const m = (s.textContent || '').match(/"sesskey"\s*:\s*"([^"]+)"/);
      if (m) {
        cachedSesskey = m[1];
        return cachedSesskey;
      }
    }

    const sessLink = document.querySelector('a[href*="sesskey="]');
    if (sessLink) {
      const m = (sessLink.getAttribute('href') || '').match(/[?&]sesskey=([^&#]+)/);
      if (m) {
        cachedSesskey = decodeURIComponent(m[1]);
        return cachedSesskey;
      }
    }
    return null;
  }

  async function fetchMoodleData() {
    const sesskey = getSesskey();
    let courses = [];
    let deadlines = [];

    if (sesskey) {
      try {
        const nowSec = Math.floor(Date.now() / 1000);
        const payload = [
          {
            index: 0,
            methodname: 'core_course_get_enrolled_courses_by_timeline_classification',
            args: {
              offset: 0,
              limit: 0,
              classification: 'all',
              sort: 'fullname',
              customfieldname: '',
              customfieldvalue: ''
            }
          },
          {
            index: 1,
            methodname: 'core_calendar_get_action_events_by_timesort',
            args: {
              limitnum: 15,
              timesortfrom: nowSec - 86400,
              limittononsuspendedevents: true
            }
          }
        ];

        const resp = await fetch(`${getWwwroot()}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (resp.ok) {
          const json = await resp.json();
          if (Array.isArray(json)) {
            const cRes = json[0];
            if (cRes && !cRes.error && cRes.data && Array.isArray(cRes.data.courses)) {
              courses = cRes.data.courses.map((c) => ({
                id: String(c.id),
                title: c.fullname || c.shortname || `Kurzus #${c.id}`,
                category: c.coursecategory || 'Kurzus',
                url: c.viewurl || `${getWwwroot()}/course/view.php?id=${c.id}`,
                img: c.courseimage || '',
                progress: typeof c.progress === 'number' ? Math.round(c.progress) : null,
                hasprogress: Boolean(c.hasprogress)
              }));
            }

            const dRes = json[1];
            if (dRes && !dRes.error && dRes.data && Array.isArray(dRes.data.events)) {
              deadlines = dRes.data.events.map((e) => ({
                id: String(e.id),
                name: e.name || 'Feladat',
                courseName: e.course?.fullname || '',
                url: e.url || e.action?.url || '#',
                actionName: e.action?.name || 'Megnyitás',
                actionUrl: e.action?.url || e.url || '#',
                timesort: e.timesort || 0
              }));
            }
          }
        }
      } catch (_) {}
    }

    if (courses.length === 0) {
      const existing = state.cachedCourses || [];
      if (existing.length > 0) {
        const harvested = harvestDomCourses(existing);
        courses = harvested.added > 0 ? harvested.courses : [];
      } else {
        courses = harvestDomCourses();
      }
    }

    if (deadlines.length === 0) {
      document.querySelectorAll('.block_calendar_upcoming .event a[href*="/mod/"], [data-region="event-list-item"] a[href*="/mod/"]').forEach((a, idx) => {
        deadlines.push({
          id: `dom-${idx}`,
          name: a.textContent.trim(),
          courseName: '',
          url: a.href,
          actionName: 'Megnyitás',
          actionUrl: a.href,
          timesort: 0
        });
      });
    }

    const patch = {};
    if (courses.length > 0) patch.cachedCourses = courses;
    if (deadlines.length > 0) patch.cachedDeadlines = deadlines;
    if (Object.keys(patch).length > 0) {
      saveState(patch);
    }

    renderSidebarCourses();
    renderDashboardHub();
  }

  function harvestDomCourses(existingList = []) {
    const merged = new Map(existingList.map((c) => [String(c.id), c]));
    let added = 0;
    document.querySelectorAll('a[href*="/course/view.php?id="]').forEach((a) => {
      if (a.closest('#mp-sidebar, #mp-overhaul-dashboard, #mp-mobile-topbar, #mp-course-hero, .secondary-navigation')) return;
      const href = a.href;
      const m = href.match(/[?&]id=(\d+)/);
      const text = a.textContent.replace(/\s+/g, ' ').trim();
      if (m && text && !merged.has(String(m[1]))) {
        merged.set(String(m[1]), {
          id: String(m[1]),
          title: text,
          category: 'Kurzus',
          url: href,
          img: '',
          progress: null,
          hasprogress: false
        });
        added++;
      }
    });
    return existingList.length > 0 ? { courses: Array.from(merged.values()), added } : Array.from(merged.values());
  }

  // --------------------------------------------------------------------------
  // 4. Shadow DOM Shell (Single Top-Right Trigger, Customizer, Modals, Toasts)
  // --------------------------------------------------------------------------
  function ensureShadowShell() {
    if (shadowRoot && document.getElementById('mp-shadow-host')) return shadowRoot;

    document.getElementById('mp-shadow-host')?.remove();
    const host = document.createElement('div');
    host.id = 'mp-shadow-host';
    applyShadowHostScheme(host);
    document.body.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = getShadowStyles();
    shadowRoot.appendChild(style);

    const container = document.createElement('div');
    container.id = 'mp-shadow-root';
    container.innerHTML = `
      <div id="mp-top-right-bar"></div>
      <aside id="mp-customizer-drawer" role="dialog" aria-label="Megjelenés és elrendezés beállításai" aria-hidden="true" inert></aside>
      <div id="mp-modal-root"></div>
      <div id="mp-toast-container" aria-live="polite"></div>
    `;
    shadowRoot.appendChild(container);
    return shadowRoot;
  }

  function getShadowStyles() {
    return `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        font-size: 13px;
        line-height: 1.4;
        --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        --radius-outer: 8px;
        --radius-inner: 4px;
        /* Palette (--bg-*, --text-*, --border-*, --accent*) is inherited from the
           active page preset on <html>, so the drawer always matches the page. */
      }

      :host([data-ui-scheme="dark"]) {
        --bg-canvas: #09090b;
        --bg-surface: #121215;
        --bg-elevated: #18181c;
        --bg-hover: #222228;
        --text-primary: #f4f4f5;
        --text-secondary: #a1a1aa;
        --text-muted: #71717a;
        --border-subtle: rgba(255, 255, 255, 0.08);
        --border-strong: rgba(255, 255, 255, 0.16);
        --success: #10b981;
        --danger: #ef4444;
      }

      :host([data-ui-scheme="light"]) {
        --bg-canvas: #f4f4f5;
        --bg-surface: #ffffff;
        --bg-elevated: #f8f8fa;
        --bg-hover: #efeff2;
        --text-primary: #18181b;
        --text-secondary: #52525b;
        --text-muted: #71717a;
        --border-subtle: #e4e4e7;
        --border-strong: #d4d4d8;
        --success: #047857;
        --danger: #dc2626;
      }

      *, *::before, *::after {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      button, input, select {
        font-family: var(--font-sans);
      }

      :focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }

      .tabular {
        font-variant-numeric: tabular-nums;
      }

      .mono {
        font-family: var(--font-mono);
      }

      kbd {
        font-family: var(--font-mono);
        font-size: 10px;
        padding: 2px 5px;
        border-radius: 3px;
        background: var(--bg-elevated);
        border: 1px solid var(--border-strong);
        color: var(--text-secondary);
      }

      .mp-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 28px;
        padding: 0 10px;
        border-radius: var(--radius-inner);
        border: 1px solid var(--border-strong);
        background: var(--bg-elevated);
        color: var(--text-primary);
        font-size: 12px;
        font-weight: 500;
        text-decoration: none;
        cursor: pointer;
        white-space: nowrap;
        transition: background-color 120ms ease-out, border-color 120ms ease-out, transform 60ms ease-out;
      }
      .mp-btn:hover {
        background: var(--bg-hover);
      }
      .mp-btn:active {
        transform: scale(0.97);
      }
      .mp-btn-primary {
        background: var(--mp-accent-fill, var(--accent));
        border-color: var(--mp-accent-fill, var(--accent));
        color: var(--accent-fg);
      }
      .mp-btn-primary:hover {
        filter: brightness(1.08);
        background: var(--mp-accent-fill, var(--accent));
      }
      .mp-btn-success {
        background: var(--success-solid, #047857);
        border-color: var(--success-solid, #047857);
        color: var(--success-solid-fg, #ffffff);
      }
      .mp-btn-success:hover {
        filter: brightness(1.12);
        background: var(--success-solid, #047857);
      }
      .mp-btn-icon {
        width: 24px;
        height: 24px;
        padding: 0;
      }

      /* Fixed fallback slot for the customize trigger (login page, classic Moodle view).
         On overhauled pages the trigger is mounted in-flow inside the page header row. */
      #mp-top-right-bar {
        position: fixed;
        z-index: 2147483000;
        display: none;
        align-items: center;
      }
      #mp-top-right-bar[data-slot="top-right"] {
        display: flex;
        top: 16px;
        right: 16px;
      }
      #mp-top-right-bar[data-slot="bottom-right"] {
        display: flex;
        bottom: 16px;
        right: 16px;
      }
      #mp-top-right-bar[data-slot="bottom-left"] {
        display: flex;
        bottom: 16px;
        left: 16px;
      }

      /* Customizer Drawer */
      #mp-customizer-drawer {
        position: fixed;
        top: 0;
        right: 0;
        width: 340px;
        max-width: 92vw;
        height: 100vh;
        background: var(--bg-surface);
        border-left: 1px solid var(--border-strong);
        z-index: 2147483005;
        display: flex;
        flex-direction: column;
        transform: translateX(102%);
        transition: transform 180ms ease-out;
        color: var(--text-primary);
      }
      #mp-customizer-drawer.open {
        transform: translateX(0);
      }

      .mp-drawer-hdr {
        padding: 10px 12px;
        border-bottom: 1px solid var(--border-subtle);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .mp-drawer-hdr h3 {
        font-size: 14px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .mp-drawer-body {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .mp-cust-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .mp-cust-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
      }
      .mp-theme-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 6px;
      }
      .mp-theme-card {
        padding: 8px 10px;
        border-radius: var(--radius-inner);
        border: 1px solid var(--border-subtle);
        background: var(--bg-elevated);
        color: var(--text-primary);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: border-color 120ms ease-out, background-color 120ms ease-out, transform 60ms ease-out;
      }
      .mp-theme-card:hover {
        background: var(--bg-hover);
      }
      .mp-theme-card:active {
        transform: scale(0.97);
      }
      .mp-theme-card.active {
        border-color: var(--accent);
        box-shadow: inset 0 0 0 1px var(--accent);
      }
      .mp-theme-swatch {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        flex-shrink: 0;
        border: 1px solid var(--border-strong);
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .mp-theme-swatch-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }

      .mp-cust-group-box {
        background: var(--bg-elevated);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-outer);
        overflow: hidden;
      }
      .mp-cust-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        font-size: 12px;
        font-weight: 500;
      }
      .mp-cust-row + .mp-cust-row {
        border-top: 1px solid var(--border-subtle);
      }
      .mp-cust-input,
      .mp-cust-select {
        background: var(--bg-surface);
        color: var(--text-primary);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-inner);
        height: 26px;
        padding: 0 6px;
        font-size: 12px;
      }

      .mp-scale-stepper {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .mp-scale-pill {
        min-width: 42px;
        height: 24px;
        padding: 0 6px;
        border-radius: var(--radius-inner);
        border: 1px solid var(--border-subtle);
        background: var(--bg-surface);
        color: var(--text-primary);
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }

      /* Drawer sections keep their natural height inside the scrolling flex
         column; otherwise overflow:hidden blocks (the <details>) collapse to 0
         min-height and an opened section is clipped back to its summary. */
      .mp-drawer-body > * {
        flex-shrink: 0;
      }
      .mp-cust-advanced {
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-outer);
        background: var(--bg-elevated);
        overflow: hidden;
      }
      .mp-cust-advanced summary {
        padding: 8px 10px;
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
        cursor: pointer;
        user-select: none;
        list-style: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .mp-cust-advanced summary:hover {
        color: var(--text-primary);
      }
      .mp-cust-advanced[open] summary {
        border-bottom: 1px solid var(--border-subtle);
      }
      .mp-cust-advanced summary::-webkit-details-marker {
        display: none;
      }
      .mp-cust-advanced summary svg {
        transition: transform 140ms ease-out;
      }
      .mp-cust-advanced[open] summary svg {
        transform: rotate(180deg);
      }
      .mp-seg-group {
        display: inline-flex;
        align-items: center;
        background: var(--bg-surface);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-inner);
        padding: 2px;
        gap: 2px;
      }
      .mp-seg-btn {
        border: none;
        background: transparent;
        color: var(--text-secondary);
        font-size: 11px;
        font-weight: 500;
        padding: 3px 8px;
        border-radius: 3px;
        cursor: pointer;
        transition: background-color 120ms ease-out, color 120ms ease-out, transform 60ms ease-out;
      }
      .mp-seg-btn:hover {
        color: var(--text-primary);
      }
      .mp-seg-btn:active {
        transform: scale(0.97);
      }
      .mp-seg-btn.active {
        background: var(--mp-accent-fill, var(--accent));
        color: var(--accent-fg);
      }
      .mp-drawer-ftr {
        padding: 10px 12px;
        border-top: 1px solid var(--border-subtle);
        background: var(--bg-surface);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      /* Lightbox & Modals inside Shadow DOM */
      .mp-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(9, 9, 11, 0.88);
        z-index: 2147483010;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .mp-lightbox-img {
        max-width: 92vw;
        max-height: 80vh;
        object-fit: contain;
        border-radius: var(--radius-outer);
        border: 1px solid var(--border-strong);
      }
      .mp-lightbox-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
      }
      .mp-lightbox-close {
        position: absolute;
        top: 16px;
        right: 16px;
        width: 34px;
        height: 34px;
        border-radius: var(--radius-inner);
        border: 1px solid var(--border-strong);
        background: var(--bg-surface);
        color: var(--text-primary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }
      .mp-lightbox-close:hover {
        background: var(--danger);
        color: #fff;
        border-color: var(--danger);
      }
      .mp-modal-box {
        background: var(--bg-surface);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-outer);
        max-width: 480px;
        width: 92%;
        padding: 14px;
        color: var(--text-primary);
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .mp-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .mp-modal-header h3 {
        font-size: 14px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .mp-cmd-box {
        background: var(--bg-canvas);
        padding: 8px 10px;
        border-radius: var(--radius-inner);
        border: 1px solid var(--border-subtle);
        font-family: var(--font-mono);
        font-size: 11px;
        word-break: break-all;
        user-select: all;
        color: var(--accent);
      }

      /* Toasts inside Shadow DOM */
      #mp-toast-container {
        position: fixed;
        bottom: 16px;
        right: 16px;
        z-index: 2147483020;
        display: flex;
        flex-direction: column;
        gap: 6px;
        pointer-events: none;
      }
      .mp-toast {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 8px 12px;
        background: var(--bg-surface);
        color: var(--text-primary);
        border: 1px solid var(--border-strong);
        border-left: 3px solid var(--accent);
        border-radius: var(--radius-inner);
        font-size: 12px;
        font-weight: 500;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.32);
      }
    `;
  }

  // --------------------------------------------------------------------------
  // 5. App Shell: Sidebar, Mobile Topbar, Single Top-Right Trigger & Customizer
  // --------------------------------------------------------------------------
  function initAppShell() {
    ensureShadowShell();
    const isSuperVideo = window.location.pathname.includes('/mod/supervideo/');
    const onLoginPage = isLoginRoute();

    if (!isSuperVideo && !onLoginPage) {
      buildSidebarAndTopbar();
    }

    buildCustomizerDrawer();
    syncTopRightTriggerPosition();
  }

  function buildSidebarAndTopbar() {
    const hostDomain = window.location.hostname || 'moodle';

    if (!document.getElementById('mp-mobile-topbar')) {
      const topbar = document.createElement('header');
      topbar.id = 'mp-mobile-topbar';
      topbar.innerHTML = `
        <div class="mp-topbar-left">
          <button type="button" class="mp-btn" id="mp-hamburger-btn" aria-label="Menü">${svgIcon('menu', 14)}</button>
          <a href="${escapeAttr(moodleUrl('/my/'))}" class="mp-brand-left" title="BetterMoodle Irányítópult">
            <span class="mp-brand-logo" aria-hidden="true">${svgLogoMark(15)}</span>
            <span class="mp-brand-title">BetterMoodle</span>
          </a>
        </div>
        <div class="mp-topbar-links">
          <a href="${escapeAttr(moodleUrl('/my/'))}" class="mp-btn">${svgIcon('bolt', 13)}<span>Irányítópult</span></a>
          <button type="button" class="mp-btn mp-btn-danger" id="mp-topbar-logout-btn" title="Kijelentkezés">${svgIcon('log-out', 13)}<span>Kilépés</span></button>
        </div>
      `;
      document.body.appendChild(topbar);

      topbar.querySelector('#mp-hamburger-btn').addEventListener('click', () => {
        document.getElementById('mp-sidebar')?.classList.toggle('mp-sidebar-open');
      });
      topbar.querySelector('#mp-topbar-logout-btn').addEventListener('click', performSignOut);
    }

    if (!document.getElementById('mp-sidebar')) {
      const path = window.location.pathname;
      const rootPath = new URL(getWwwroot()).pathname.replace(/\/+$/, '');
      const onDashboard = [`${rootPath}/my/`, `${rootPath}/my/index.php`, `${rootPath}/my/courses.php`, `${rootPath}/`, rootPath].includes(path);
      const sidebar = document.createElement('aside');
      sidebar.id = 'mp-sidebar';
      sidebar.innerHTML = `
        <div class="mp-sidebar-brand">
          <a href="${escapeAttr(moodleUrl('/my/'))}" class="mp-brand-left" title="${escapeAttr(getMoodleSiteLabel())}">
            <div class="mp-brand-logo" aria-hidden="true">${svgLogoMark(16)}</div>
            <div class="mp-brand-text">
              <span class="mp-brand-title">BetterMoodle</span>
              <span class="mp-brand-sub" title="${escapeAttr(hostDomain)}">${escapeHtml(hostDomain)}</span>
            </div>
          </a>
          <button type="button" class="mp-btn" id="mp-sb-close-mobile" aria-label="Menü bezárása" style="display:none;padding:4px 6px;">${svgIcon('x', 13)}</button>
        </div>
        <nav class="mp-sidebar-nav" aria-label="Fő navigáció">
          <a href="${escapeAttr(moodleUrl('/my/'))}" class="mp-nav-link ${onDashboard ? 'active' : ''}"${onDashboard ? ' aria-current="page"' : ''}>${svgIcon('bolt', 14)}<span>Irányítópult</span></a>
        </nav>
        <div class="mp-sidebar-courses-hdr">
          <span>Kurzusaim</span>
          <span id="mp-sb-course-count">0</span>
        </div>
        <div class="mp-sidebar-courses" id="mp-sidebar-courses"></div>
        <div class="mp-sidebar-footer">
          <button type="button" class="mp-btn mp-btn-danger" id="mp-sb-logout-btn" style="width:100%;" title="Kijelentkezés a Moodle fiókból">${svgIcon('log-out', 13)}<span>Kijelentkezés</span></button>
        </div>
      `;
      document.body.appendChild(sidebar);

      sidebar.querySelector('#mp-sb-logout-btn').addEventListener('click', performSignOut);
      sidebar.querySelector('#mp-sb-close-mobile').addEventListener('click', () => {
        sidebar.classList.remove('mp-sidebar-open');
      });
    }

    renderSidebarCourses();
  }

  function renderSidebarCourses() {
    const list = document.getElementById('mp-sidebar-courses');
    const countEl = document.getElementById('mp-sb-course-count');
    if (!list) return;

    const courses = [...(state.cachedCourses || [])];
    const pinnedSet = new Set(state.pinnedCourses || []);
    const currentCourseId = getCurrentCourseId();

    courses.sort((a, b) => {
      const ap = pinnedSet.has(a.id) ? 0 : 1;
      const bp = pinnedSet.has(b.id) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return String(a.title || '').localeCompare(String(b.title || ''), 'hu');
    });

    if (countEl) countEl.textContent = String(courses.length);
    list.innerHTML = '';

    courses.forEach((c) => {
      const isPinned = pinnedSet.has(c.id);
      const isActive = Boolean(currentCourseId) && String(c.id) === currentCourseId;
      const row = document.createElement('div');
      row.className = `mp-sb-course-item ${isActive ? 'active' : ''}`;
      row.innerHTML = `
        <a href="${escapeAttr(c.url)}" class="mp-sb-course-link" title="${escapeAttr(c.title)}"${isActive ? ' aria-current="page"' : ''}>${escapeHtml(c.title)}</a>
        <button type="button" class="mp-sb-pin ${isPinned ? 'pinned' : ''}" title="${isPinned ? 'Kitűzés levétele' : 'Kitűzés'}" aria-label="${isPinned ? 'Kitűzés levétele' : 'Kitűzés'}: ${escapeAttr(c.title)}">${svgIcon(isPinned ? 'star-filled' : 'star', 13)}</button>
      `;
      row.querySelector('.mp-sb-pin').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleCoursePin(c.id, c.title);
      });
      list.appendChild(row);
    });
  }

  function toggleCoursePin(courseId, title) {
    const set = new Set(state.pinnedCourses || []);
    if (set.has(courseId)) {
      set.delete(courseId);
      showToast(`Eltávolítva a kitűzöttek közül: ${title}`);
    } else {
      set.add(courseId);
      showToast(`Kitűzve a tetejére: ${title}`);
    }
    saveState({ pinnedCourses: Array.from(set) });
    renderSidebarCourses();
    renderDashboardHub();
  }

  function buildCustomizerDrawer() {
    const drawer = shadowRoot?.getElementById('mp-customizer-drawer');
    if (!drawer) return;

    const themes = [
      { id: 'midnight', name: 'Midnight', color: '#3b82f6', bg: '#09090b' },
      { id: 'oled', name: 'OLED Black', color: '#10b981', bg: '#000000' },
      { id: 'catppuccin', name: 'Catppuccin', color: '#89b4fa', bg: '#181825' },
      { id: 'light', name: 'Clean Light', color: '#2563eb', bg: '#f4f4f5' }
    ];
    const activeTheme = normalizeTheme(state.theme);
    const radiusVal = Math.min(16, Math.max(0, Number(state.cardRadius ?? 8)));
    const scaleVal = clampUiScale(state.uiScale);

    drawer.innerHTML = `
      <div class="mp-drawer-hdr">
        <h3>${svgIcon('sliders', 14)}<span>Megjelenés és Elrendezés</span></h3>
        <div style="display:flex;align-items:center;gap:6px;">
          <kbd>Esc</kbd>
          <button type="button" class="mp-btn" id="mp-drawer-close" aria-label="Panel bezárása">${svgIcon('x', 13)}</button>
        </div>
      </div>
      <div class="mp-drawer-body">
        <div class="mp-cust-group">
          <span class="mp-cust-label">Téma Előbeállítás</span>
          <div class="mp-theme-grid">
            ${themes.map((t) => `
              <button type="button" class="mp-theme-card ${activeTheme === t.id ? 'active' : ''}" data-theme-id="${t.id}">
                <span class="mp-theme-swatch" style="background:${t.bg};">
                  <span class="mp-theme-swatch-dot" style="background:${t.color};"></span>
                </span>
                <span>${t.name}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="mp-cust-group">
          <span class="mp-cust-label">Kezelőfelület és Színek</span>
          <div class="mp-cust-group-box">
            <div class="mp-cust-row">
              <label for="mp-cust-uischeme">Bővítmény mód</label>
              <select id="mp-cust-uischeme" class="mp-cust-select">
                <option value="auto" ${state.uiScheme === 'auto' ? 'selected' : ''}>Rendszer</option>
                <option value="dark" ${state.uiScheme === 'dark' ? 'selected' : ''}>Sötét</option>
                <option value="light" ${state.uiScheme === 'light' ? 'selected' : ''}>Világos</option>
              </select>
            </div>
            <div class="mp-cust-row">
              <span>Kiemelő szín</span>
              <div style="display:flex;gap:6px;align-items:center;">
                <input type="color" id="mp-cust-accent" value="${escapeAttr(state.customAccent || themeHex('--accent', '#3b82f6'))}" aria-label="Egyéni kiemelő szín" />
                <button type="button" class="mp-btn" id="mp-cust-accent-reset" style="height:24px;padding:0 6px;">Alap</button>
              </div>
            </div>
            <div class="mp-cust-row">
              <span>Háttérszín</span>
              <div style="display:flex;gap:6px;align-items:center;">
                <input type="color" id="mp-cust-bg" value="${escapeAttr(state.customBg || themeHex('--bg-canvas', '#09090b'))}" aria-label="Egyéni háttérszín" />
                <button type="button" class="mp-btn" id="mp-cust-bg-reset" style="height:24px;padding:0 6px;">Alap</button>
              </div>
            </div>
          </div>
        </div>

        <div class="mp-cust-group">
          <span class="mp-cust-label">Méret és Elrendezés</span>
          <div class="mp-cust-group-box">
            <div class="mp-cust-row">
              <span>Felület méret</span>
              <div class="mp-scale-stepper">
                <button type="button" class="mp-btn mp-btn-icon" id="mp-scale-dec" title="Kisebb (-5%)" aria-label="Felület kicsinyítése">${svgIcon('zoom-out', 12)}</button>
                <button type="button" class="mp-scale-pill tabular" id="mp-scale-val" title="Visszaállítás 100%-ra">${scaleVal}%</button>
                <button type="button" class="mp-btn mp-btn-icon" id="mp-scale-inc" title="Nagyobb (+5%)" aria-label="Felület nagyítása">${svgIcon('zoom-in', 12)}</button>
              </div>
            </div>
            <div class="mp-cust-row">
              <span style="color:var(--text-secondary);">Finomhangolás</span>
              <input type="range" id="mp-cust-scale" min="85" max="125" step="5" value="${scaleVal}" style="width:128px;" aria-label="Felület méret csúszka" />
            </div>
            <div class="mp-cust-row">
              <span>Sarokkerekítés (<span class="tabular" id="mp-radius-val">${radiusVal}</span>px)</span>
              <input type="range" id="mp-cust-radius" min="0" max="16" step="2" value="${radiusVal}" style="width:104px;" aria-label="Kártya sarokkerekítés" />
            </div>
            <div class="mp-cust-row">
              <label for="mp-cust-nav">Navigáció helye</label>
              <select id="mp-cust-nav" class="mp-cust-select">
                <option value="sidebar" ${state.navStyle === 'sidebar' ? 'selected' : ''}>Bal oldalsáv</option>
                <option value="topbar" ${state.navStyle === 'topbar' ? 'selected' : ''}>Felső sáv</option>
              </select>
            </div>
            <div class="mp-cust-row">
              <label for="mp-cust-density">Sűrűség</label>
              <select id="mp-cust-density" class="mp-cust-select">
                <option value="normal" ${state.density === 'normal' ? 'selected' : ''}>Normál</option>
                <option value="compact" ${state.density === 'compact' ? 'selected' : ''}>Kompakt</option>
              </select>
            </div>
          </div>
        </div>

        <div class="mp-cust-group">
          <span class="mp-cust-label">Kurzus navigációs sáv</span>
          <div class="mp-cust-group-box">
            <div class="mp-cust-row">
              <span>Megjelenítés</span>
              <div class="mp-seg-group" role="group" aria-label="Kurzus navigáció stílusa">
                <button type="button" class="mp-seg-btn mp-cnav-seg-btn ${(state.courseNavStyle || 'icons') === 'icons' ? 'active' : ''}" data-cnav-style="icons" aria-pressed="${String((state.courseNavStyle || 'icons') === 'icons')}">Ikonok</button>
                <button type="button" class="mp-seg-btn mp-cnav-seg-btn ${state.courseNavStyle === 'both' ? 'active' : ''}" data-cnav-style="both" aria-pressed="${String(state.courseNavStyle === 'both')}">Mindkettő</button>
                <button type="button" class="mp-seg-btn mp-cnav-seg-btn ${state.courseNavStyle === 'text' ? 'active' : ''}" data-cnav-style="text" aria-pressed="${String(state.courseNavStyle === 'text')}">Szöveg</button>
              </div>
            </div>
            <div class="mp-cust-row">
              <span>Sáv háttérszín</span>
              <div style="display:flex;gap:6px;align-items:center;">
                <input type="color" id="mp-cust-cnav-bg" value="${isHexColor(state.courseNavBg) ? state.courseNavBg : themeHex('--bg-surface', '#121215')}" aria-label="Kurzus navigációs sáv háttérszín" />
                <input type="text" id="mp-cust-cnav-bg-hex" class="mp-cust-input mono" value="${escapeAttr(state.courseNavBg || '')}" placeholder="Alap" maxlength="7" style="width:68px;" aria-label="Kurzus sáv hex kód" />
                <button type="button" class="mp-btn" id="mp-cust-cnav-bg-reset" style="height:24px;padding:0 6px;">Alap</button>
              </div>
            </div>
          </div>
        </div>

        <div class="mp-cust-group">
          <span class="mp-cust-label">Egyéni Háttérkép URL</span>
          <div style="display:flex;gap:6px;">
            <input type="text" id="mp-cust-wallpaper" class="mp-cust-input" placeholder="https://.../hatter.jpg" value="${escapeAttr(state.wallpaperUrl || '')}" style="flex:1;" aria-label="Egyéni háttérkép URL" />
            <button type="button" class="mp-btn mp-btn-primary" id="mp-cust-wallpaper-apply">OK</button>
          </div>
        </div>

        <div class="mp-cust-group">
          <span class="mp-cust-label">Tananyag viselkedés</span>
          <div class="mp-cust-group-box">
            <label class="mp-cust-row" style="cursor:pointer;">
              <span>Videók/mappák helyben kibontása</span>
              <input type="checkbox" id="mp-cust-unwrap" ${state.autoUnwrap ? 'checked' : ''} />
            </label>
            <label class="mp-cust-row" style="cursor:pointer;">
              <span>Teljesítési feltételek elrejtése</span>
              <input type="checkbox" id="mp-cust-hidecomp" ${state.hideCompletion ? 'checked' : ''} />
            </label>
          </div>
        </div>

        <details class="mp-cust-advanced">
          <summary>
            <span>Speciális beállítások</span>
            ${svgIcon('chevron-down', 13)}
          </summary>
          <label class="mp-cust-row" style="cursor:pointer;">
            <span>BetterMoodle Overhaul aktív</span>
            <input type="checkbox" id="mp-cust-overhaul" ${state.overhaulMode ? 'checked' : ''} />
          </label>
        </details>
      </div>
      <div class="mp-drawer-ftr">
        <a href="https://github.com/CsPS0/BetterMoodle" target="_blank" rel="noopener noreferrer" class="mp-btn" title="BetterMoodle a GitHubon">
          ${svgIcon('cat', 14)}
          <span>GitHub</span>
        </a>
        ${getExtensionVersion() ? `<span class="mono tabular" style="font-size:11px;color:var(--text-muted);">v${escapeHtml(getExtensionVersion())}</span>` : ''}
      </div>
    `;

    drawer.querySelector('#mp-drawer-close').addEventListener('click', () => toggleCustomizer(false));

    // The advanced section sits at the bottom of the scrolling body: reveal it when opened.
    const advanced = drawer.querySelector('.mp-cust-advanced');
    advanced?.addEventListener('toggle', () => {
      if (advanced.open) advanced.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    drawer.querySelectorAll('.mp-theme-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const themeId = btn.dataset.themeId;
        drawer.querySelectorAll('.mp-theme-card').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        saveState({ theme: themeId, customAccent: '', customBg: '' });
        applyVisualSettings();
        syncShadowControls();
      });
    });

    drawer.querySelector('#mp-cust-uischeme').addEventListener('change', (e) => {
      saveState({ uiScheme: e.target.value });
      applyVisualSettings();
    });

    drawer.querySelector('#mp-cust-accent').addEventListener('input', (e) => {
      saveState({ customAccent: e.target.value });
      applyVisualSettings();
    });
    drawer.querySelector('#mp-cust-accent-reset').addEventListener('click', () => {
      saveState({ customAccent: '' });
      applyVisualSettings();
      syncShadowControls();
    });

    drawer.querySelector('#mp-cust-bg').addEventListener('input', (e) => {
      saveState({ customBg: e.target.value });
      applyVisualSettings();
    });
    drawer.querySelector('#mp-cust-bg-reset').addEventListener('click', () => {
      saveState({ customBg: '' });
      applyVisualSettings();
      syncShadowControls();
    });

    const updateScale = (nextVal) => {
      const clamped = clampUiScale(nextVal);
      saveState({ uiScale: clamped });
      applyVisualSettings();
      syncShadowControls();
    };

    drawer.querySelector('#mp-scale-dec').addEventListener('click', () => updateScale(clampUiScale(state.uiScale) - 5));
    drawer.querySelector('#mp-scale-inc').addEventListener('click', () => updateScale(clampUiScale(state.uiScale) + 5));
    drawer.querySelector('#mp-scale-val').addEventListener('click', () => updateScale(100));
    drawer.querySelector('#mp-cust-scale').addEventListener('input', (e) => updateScale(e.target.value));

    drawer.querySelector('#mp-cust-radius').addEventListener('input', (e) => {
      const val = Number(e.target.value);
      drawer.querySelector('#mp-radius-val').textContent = String(val);
      saveState({ cardRadius: val });
      applyVisualSettings();
    });

    drawer.querySelector('#mp-cust-nav').addEventListener('change', (e) => {
      saveState({ navStyle: e.target.value });
      applyVisualSettings();
    });

    drawer.querySelector('#mp-cust-density').addEventListener('change', (e) => {
      saveState({ density: e.target.value });
      applyVisualSettings();
    });

    drawer.querySelectorAll('.mp-cnav-seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextStyle = btn.dataset.cnavStyle || 'icons';
        saveState({ courseNavStyle: nextStyle });
        applyVisualSettings();
        syncShadowControls();
      });
    });

    const cnavPicker = drawer.querySelector('#mp-cust-cnav-bg');
    const cnavHex = drawer.querySelector('#mp-cust-cnav-bg-hex');
    cnavPicker.addEventListener('input', (e) => {
      cnavHex.value = e.target.value;
      saveState({ courseNavBg: e.target.value });
      applyVisualSettings();
    });
    cnavHex.addEventListener('change', (e) => {
      const val = e.target.value.trim();
      if (!val) {
        saveState({ courseNavBg: '' });
        applyVisualSettings();
      } else if (isHexColor(val)) {
        cnavPicker.value = val;
        saveState({ courseNavBg: val });
        applyVisualSettings();
      }
    });
    drawer.querySelector('#mp-cust-cnav-bg-reset').addEventListener('click', () => {
      cnavHex.value = '';
      cnavPicker.value = themeHex('--bg-surface', '#121215');
      saveState({ courseNavBg: '' });
      applyVisualSettings();
    });

    drawer.querySelector('#mp-cust-wallpaper-apply').addEventListener('click', () => {
      const url = drawer.querySelector('#mp-cust-wallpaper').value.trim();
      saveState({ wallpaperUrl: url });
      applyVisualSettings();
      showToast(url ? 'Egyéni háttérkép alkalmazva' : 'Háttérkép törölve');
    });

    drawer.querySelector('#mp-cust-overhaul').addEventListener('change', (e) => {
      saveState({ overhaulMode: e.target.checked });
      applyVisualSettings();
      showToast(state.overhaulMode ? 'BetterMoodle Overhaul bekapcsolva' : 'Eredeti Moodle nézet');
    });

    drawer.querySelector('#mp-cust-unwrap').addEventListener('change', (e) => {
      saveState({ autoUnwrap: e.target.checked });
    });

    drawer.querySelector('#mp-cust-hidecomp').addEventListener('change', (e) => {
      saveState({ hideCompletion: e.target.checked });
      applyVisualSettings();
    });
  }

  function toggleCustomizer(forceState) {
    const drawer = shadowRoot?.getElementById('mp-customizer-drawer');
    if (!drawer) return;
    const shouldOpen = typeof forceState === 'boolean' ? forceState : !drawer.classList.contains('open');
    const trigger = triggerHost?.shadowRoot?.getElementById('mp-top-cust-btn');
    if (!shouldOpen && shadowRoot?.activeElement && drawer.contains(shadowRoot.activeElement)) {
      trigger?.focus({ preventScroll: true });
    }
    drawer.classList.toggle('open', shouldOpen);
    drawer.setAttribute('aria-hidden', String(!shouldOpen));
    drawer.inert = !shouldOpen;
    trigger?.setAttribute('aria-expanded', String(shouldOpen));
    if (shouldOpen) {
      drawer.querySelector('#mp-drawer-close')?.focus({ preventScroll: true });
    }
  }

  function toggleOverhaulMode() {
    saveState({ overhaulMode: !state.overhaulMode });
    applyVisualSettings();
    syncShadowControls();
    showToast(state.overhaulMode ? 'BetterMoodle Overhaul bekapcsolva' : 'Eredeti Moodle nézet');
  }

  // --------------------------------------------------------------------------
  // 6. Login Page, Timed-Out Relogin & Logout Confirm Overhaul
  // --------------------------------------------------------------------------
  function initLoginOverhaul() {
    document.body.setAttribute('data-mp-page', 'login');
    // Moodle 5+ renders a split login (hero image column + form column); older
    // versions render one centered card. Keep the native split instead of
    // forcing every layout into a single narrow card.
    const isSplit = Boolean(document.querySelector('.login-layout-right, .login-layout-left'));
    document.body.setAttribute('data-mp-login-layout', isSplit ? 'split' : 'card');

    // Insert inside the form card, never as a flex sibling of it.
    const cardTarget = ['.loginform', '.login-container', '#region-main .card-body', '#region-main .box.generalbox', '#region-main']
      .map((sel) => document.querySelector(sel))
      .find(Boolean);
    if (!cardTarget) return;

    if (!document.getElementById('mp-login-header')) {
      const path = window.location.pathname;
      const search = window.location.search;
      const hasAlert = Boolean(document.querySelector('.loginerrors .alert, .loginform .alert-danger, .loginform .alert-warning, #loginerrormessage'));
      let cameFromCoursePage = false;
      try {
        const ref = document.referrer ? new URL(document.referrer) : null;
        const rootPath = new URL(getWwwroot()).pathname.replace(/\/+$/, '');
        cameFromCoursePage = Boolean(ref && ref.origin === window.location.origin
          && !ref.pathname.includes('/login/')
          && ![`${rootPath}/`, `${rootPath}/index.php`, rootPath].includes(ref.pathname));
      } catch (_) {}
      const isLogoutPage = path.includes('/login/logout.php');
      const isTimedOut = !isLogoutPage && (hasAlert || search.includes('testsession') || search.includes('reason=') || cameFromCoursePage);

      // The site already shows its own logo / heading: only add the status banner.
      const hasOwnIdentity = Boolean(document.querySelector('#loginlogo, .login-logo, .loginform h1, .login-container h1, .login-heading'));
      const banner = isTimedOut ? `
          <div id="mp-relogin-banner" role="status">
            ${svgIcon('alert-circle', 14)}
            <span>Munkamenet lejárt — jelentkezz be a folytatáshoz</span>
          </div>
        ` : isLogoutPage ? `
          <div id="mp-relogin-banner" class="is-neutral" role="status">
            ${svgIcon('log-out', 14)}
            <span>Kijelentkezés megerősítése</span>
          </div>
        ` : '';

      if (!hasOwnIdentity || banner) {
        const header = document.createElement('div');
        header.id = 'mp-login-header';
        if (hasOwnIdentity) header.classList.add('is-banner-only');
        header.innerHTML = `
          ${hasOwnIdentity ? '' : `
            <div class="mp-login-brand">
              <span class="mp-brand-logo" aria-hidden="true">${svgLogoMark(16)}</span>
              <div class="mp-brand-text">
                <span class="mp-login-site" title="${escapeAttr(getMoodleSiteLabel())}">${escapeHtml(getMoodleSiteLabel())}</span>
                <span class="mp-login-domain">${escapeHtml(window.location.hostname)}</span>
              </div>
            </div>
          `}
          ${banner}
        `;
        // Banner sits right under the site logo, above the "Welcome back" heading.
        const anchor = hasOwnIdentity ? cardTarget.querySelector(':scope > h1, :scope > .login-heading, :scope > h2') : null;
        cardTarget.insertBefore(header, anchor || cardTarget.firstChild);
      }
    }

    const userInput = document.getElementById('username');
    const passInput = document.getElementById('password');
    if (userInput && !userInput.placeholder) userInput.placeholder = 'Felhasználónév';
    if (passInput && !passInput.placeholder) passInput.placeholder = 'Jelszó';

    if (userInput && userInput.value && passInput) {
      passInput.focus();
    } else if (userInput && !userInput.value) {
      userInput.focus();
    }
  }

  // --------------------------------------------------------------------------
  // 7. Custom Dashboard Workspace (/my/ and /my/courses.php) - Calendar View
  // --------------------------------------------------------------------------
  const CAL_WEEKDAY_SHORT = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];
  const CAL_WEEKDAY_FULL = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat', 'Vasárnap'];

  function calNoon(dateObj) {
    const d = dateObj instanceof Date ? dateObj : new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
  }

  function calDayKey(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function calMonthKey(year, month1to12) {
    return `${year}-${String(month1to12).padStart(2, '0')}`;
  }

  function calGetWeekStart(dateObj) {
    const d = calNoon(dateObj);
    const offset = (d.getDay() + 6) % 7; // Monday = 0
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset, 12, 0, 0);
  }

  function calFormatTimeHu(tsSec) {
    if (!tsSec) return '';
    return new Date(tsSec * 1000).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
  }

  function calFormatPeriodLabel(view, cursor) {
    if (view === 'day') {
      return new Intl.DateTimeFormat('hu-HU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      }).format(cursor);
    }
    if (view === 'week') {
      const start = calGetWeekStart(cursor);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 12, 0, 0);
      const mFmt = new Intl.DateTimeFormat('hu-HU', { month: 'short' });
      if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
        return `${start.getFullYear()}. ${mFmt.format(start)} ${start.getDate()}–${end.getDate()}.`;
      }
      const endYear = end.getFullYear() !== start.getFullYear() ? `${end.getFullYear()}. ` : '';
      return `${start.getFullYear()}. ${mFmt.format(start)} ${start.getDate()}. – ${endYear}${mFmt.format(end)} ${end.getDate()}.`;
    }
    return new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: 'long' }).format(cursor);
  }

  function calShiftCursor(view, cursor, delta) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const day = cursor.getDate();
    if (view === 'day') {
      return new Date(y, m, day + delta, 12, 0, 0);
    }
    if (view === 'week') {
      return new Date(y, m, day + delta * 7, 12, 0, 0);
    }
    return new Date(y, m + delta, 1, 12, 0, 0);
  }

  function parseMoodleMonthlyAjax(data) {
    const out = [];
    const weeks = Array.isArray(data?.weeks) ? data.weeks : [];
    weeks.forEach((week) => {
      const days = Array.isArray(week?.days) ? week.days : [];
      days.forEach((day) => {
        const dayTs = Number(day?.timestamp) || 0;
        const events = Array.isArray(day?.events) ? day.events : [];
        events.forEach((ev) => {
          const ts = Number(ev?.timestart) || dayTs;
          const dObj = ts ? new Date(ts * 1000) : new Date(day.year, (day.mon || 1) - 1, day.mday || 1, 12, 0, 0);
          out.push({
            id: String(ev?.id || `${ts}-${ev?.name || 'ev'}`),
            name: String(ev?.name || ev?.popupname || 'Esemény').replace(/\s+/g, ' ').trim(),
            courseName: String(ev?.course?.fullname || ev?.course?.shortname || '').trim(),
            url: ev?.url || ev?.viewurl || `${getWwwroot()}/calendar/view.php?view=day&course=1&time=${ts}`,
            actionName: ev?.action?.name || '',
            actionUrl: ev?.action?.url || '',
            timestamp: ts,
            dayKey: calDayKey(dObj)
          });
        });
      });
    });
    return out;
  }

  function parseMoodleCalendarHtml(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const out = [];
    doc.querySelectorAll('td[data-day-timestamp], [data-region="day"][data-day-timestamp]').forEach((cell) => {
      const dayTs = Number(cell.getAttribute('data-day-timestamp') || 0);
      if (!dayTs) return;
      const dayDate = new Date(dayTs * 1000);
      const dayKey = calDayKey(dayDate);
      cell.querySelectorAll('.calendarevent a, a[data-action="view-event"], [data-region="event-item"] a').forEach((link, idx) => {
        const name = link.textContent.replace(/\s+/g, ' ').trim();
        if (!name) return;
        const evWrap = link.closest('[data-event-id]');
        const evId = evWrap?.getAttribute('data-event-id') || `html-${dayTs}-${idx}`;
        out.push({
          id: String(evId),
          name,
          courseName: '',
          url: link.getAttribute('href') || `${getWwwroot()}/calendar/view.php?view=day&course=1&time=${dayTs}`,
          actionName: '',
          actionUrl: '',
          timestamp: dayTs,
          dayKey
        });
      });
    });
    return out;
  }

  async function fetchCalendarMonth(year, month1to12) {
    const key = calMonthKey(year, month1to12);
    if (calendarMonthCache.has(key) || calendarInFlightKeys.has(key)) return;

    const sesskey = getSesskey();
    if (!sesskey && !(window.M && window.M.cfg)) return;

    calendarInFlightKeys.add(key);
    let loadedEvents = [];
    let resolved = false;

    try {
      if (sesskey) {
        const payload = [{
          index: 0,
          methodname: 'core_calendar_get_calendar_monthly_view',
          args: {
            year: Number(year),
            month: Number(month1to12),
            courseid: 1,
            categoryid: 0,
            includenavigation: true,
            mini: false,
            day: 1
          }
        }];
        const resp = await fetch(`${getWwwroot()}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (resp.ok) {
          const json = await resp.json();
          const res = Array.isArray(json) ? json[0] : null;
          if (res && !res.error && res.data && Array.isArray(res.data.weeks)) {
            loadedEvents = parseMoodleMonthlyAjax(res.data);
            resolved = true;
          }
        }
      }

      if (!resolved && window.location.protocol.startsWith('http')) {
        const midSec = Math.floor(new Date(year, month1to12 - 1, 15, 12, 0, 0).getTime() / 1000);
        const pageResp = await fetch(`${getWwwroot()}/calendar/view.php?view=month&course=1&time=${midSec}`, {
          credentials: 'same-origin'
        });
        if (pageResp.ok) {
          const htmlText = await pageResp.text();
          loadedEvents = parseMoodleCalendarHtml(htmlText);
          resolved = true;
        }
      }
    } catch (_) {}

    if (resolved) {
      calendarMonthCache.set(key, loadedEvents);
    }
    calendarInFlightKeys.delete(key);

    if (resolved && document.getElementById('mp-dash-calendar')) {
      renderCalendarViewport();
    }
  }

  function ensureCalendarRangeLoaded(datesList) {
    const months = new Map();
    datesList.forEach((d) => {
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      months.set(calMonthKey(y, m), { y, m });
    });
    months.forEach(({ y, m }) => {
      fetchCalendarMonth(y, m);
    });
  }

  function collectMergedCalendarEventsByDay(datesList) {
    const byDay = new Map();
    const seen = new Set();

    const addEvent = (ev) => {
      if (!ev || !ev.dayKey || !ev.name) return;
      const dedupeKey = `${ev.dayKey}|${ev.name.toLowerCase()}|${ev.id}`;
      const fuzzyKey = `${ev.dayKey}|${ev.name.toLowerCase()}`;
      if (seen.has(dedupeKey) || seen.has(fuzzyKey)) return;
      seen.add(dedupeKey);
      seen.add(fuzzyKey);
      if (!byDay.has(ev.dayKey)) byDay.set(ev.dayKey, []);
      byDay.get(ev.dayKey).push(ev);
    };

    const monthKeys = new Set(datesList.map((d) => calMonthKey(d.getFullYear(), d.getMonth() + 1)));
    monthKeys.forEach((mk) => {
      const cached = calendarMonthCache.get(mk);
      if (Array.isArray(cached)) cached.forEach(addEvent);
    });

    (state.cachedDeadlines || []).forEach((dl) => {
      const ts = Number(dl?.timesort) || 0;
      if (!ts) return;
      addEvent({
        id: String(dl.id || `dl-${ts}`),
        name: String(dl.name || 'Feladat').trim(),
        courseName: String(dl.courseName || '').trim(),
        url: dl.url || dl.actionUrl || `${getWwwroot()}/calendar/view.php?view=day&course=1&time=${ts}`,
        actionName: dl.actionName || '',
        actionUrl: dl.actionUrl || '',
        timestamp: ts,
        dayKey: calDayKey(new Date(ts * 1000))
      });
    });

    byDay.forEach((list) => {
      list.sort((a, b) => (a.timestamp - b.timestamp) || a.name.localeCompare(b.name, 'hu'));
    });
    return byDay;
  }

  function initDashboardOverhaul() {
    const regionMain = document.getElementById('region-main');
    if (!regionMain) return;

    if (!document.getElementById('mp-overhaul-dashboard')) {
      const hub = document.createElement('div');
      hub.id = 'mp-overhaul-dashboard';
      hub.className = 'mp-dashboard-hub';
      regionMain.insertBefore(hub, regionMain.firstChild);
    }

    renderDashboardHub();
  }

  function renderDashboardHub() {
    const hub = document.getElementById('mp-overhaul-dashboard');
    if (!hub) return;

    const deadlines = state.cachedDeadlines || [];

    hub.innerHTML = `
      <div class="mp-dash-layout">
        <div class="mp-dash-main">
          <section id="mp-dash-calendar" class="mp-calendar-card" aria-label="Kurzusnaptár">
            <div class="mp-cal-header">
              <div class="mp-cal-heading-group">
                <div class="mp-cal-title-row">
                  ${svgIcon('calendar', 16)}
                  <h1 class="mp-cal-title">Irányítópult</h1>
                  <span class="mp-cal-period-pill tabular" id="mp-cal-period-label"></span>
                </div>
                <div class="mp-cal-meta-row">
                  <span class="mp-cal-scope">Naptár &bull; Minden kurzus</span>
                  <a href="${escapeAttr(moodleUrl('/calendar/view.php?view=month&course=1'))}" id="mp-cal-open-full" class="mp-cal-ext-link" title="Megnyitás a Moodle naptárban (course=1)">
                    ${svgIcon('external-link', 12)}
                    <span>Teljes naptár</span>
                  </a>
                </div>
              </div>

              <div class="mp-cal-controls">
                <div class="mp-cal-nav" role="group" aria-label="Időszak léptetése">
                  <button type="button" class="mp-cal-nav-btn" id="mp-cal-prev" title="Előző időszak" aria-label="Előző">
                    ${svgIcon('chevron-left', 13)}
                    <span>Előző</span>
                  </button>
                  <button type="button" class="mp-cal-nav-btn" id="mp-cal-today" title="Ugrás a mai napra">Ma</button>
                  <button type="button" class="mp-cal-nav-btn" id="mp-cal-next" title="Következő időszak" aria-label="Következő">
                    <span>Következő</span>
                    ${svgIcon('chevron-right', 13)}
                  </button>
                </div>

                <div class="mp-view-toggles mp-cal-views" role="group" aria-label="Naptár nézet">
                  <button type="button" class="mp-view-btn" data-cal-view="month">Hónap</button>
                  <button type="button" class="mp-view-btn" data-cal-view="week">Hét</button>
                  <button type="button" class="mp-view-btn" data-cal-view="day">Nap</button>
                </div>
              </div>
            </div>

            <div class="mp-cal-body" id="mp-cal-body"></div>
          </section>
        </div>

        <div class="mp-dash-right">
          <div id="mp-dash-right-top" class="mp-dash-right-top">
            <span class="mp-dash-right-label">${svgIcon('palette', 14)}<span>Megjelenés</span></span>
          </div>

          <aside id="mp-deadlines-panel" aria-label="Közelgő határidők">
            <div class="mp-deadlines-hdr">
              <h3 class="mp-section-heading" style="margin:0;">${svgIcon('clock', 14)}<span>Közelgő Határidők</span></h3>
              <span class="mp-search-badge tabular">${deadlines.length}</span>
            </div>
            ${deadlines.length === 0
              ? '<p class="mp-cal-empty-note">Nincs közelgő határidős feladat.</p>'
              : `<div class="mp-deadline-list">${deadlines.map((d) => renderDeadlineCardHtml(d)).join('')}</div>`
            }
          </aside>
        </div>
      </div>
    `;

    hub.querySelector('#mp-cal-prev').addEventListener('click', () => {
      activeCalendarDate = calShiftCursor(activeCalendarView, activeCalendarDate, -1);
      renderCalendarViewport();
    });

    hub.querySelector('#mp-cal-today').addEventListener('click', () => {
      activeCalendarDate = calNoon(new Date());
      renderCalendarViewport();
    });

    hub.querySelector('#mp-cal-next').addEventListener('click', () => {
      activeCalendarDate = calShiftCursor(activeCalendarView, activeCalendarDate, 1);
      renderCalendarViewport();
    });

    hub.querySelectorAll('[data-cal-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextView = btn.dataset.calView;
        if (!['month', 'week', 'day'].includes(nextView)) return;
        activeCalendarView = nextView;
        renderCalendarViewport();
      });
    });

    const calBody = hub.querySelector('#mp-cal-body');
    calBody.addEventListener('click', (e) => {
      const targetBtn = e.target.closest('[data-cal-goto-day]');
      if (!targetBtn) return;
      const parts = (targetBtn.getAttribute('data-cal-goto-day') || '').split('-').map(Number);
      if (parts.length === 3 && parts.every(Number.isFinite)) {
        activeCalendarDate = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
        activeCalendarView = 'day';
        renderCalendarViewport();
      }
    });

    renderCalendarViewport();
    syncTopRightTriggerPosition();
  }

  function renderCalendarViewport() {
    const calEl = document.getElementById('mp-dash-calendar');
    const bodyEl = document.getElementById('mp-cal-body');
    const periodEl = document.getElementById('mp-cal-period-label');
    const fullLink = document.getElementById('mp-cal-open-full');
    if (!calEl || !bodyEl) return;

    const view = ['month', 'week', 'day'].includes(activeCalendarView) ? activeCalendarView : 'month';
    const cursor = calNoon(activeCalendarDate);
    const todayKey = calDayKey(calNoon(new Date()));

    if (periodEl) {
      periodEl.textContent = calFormatPeriodLabel(view, cursor);
    }

    if (fullLink) {
      const cursorSec = Math.floor(cursor.getTime() / 1000);
      fullLink.href = `${getWwwroot()}/calendar/view.php?view=${view}&course=1&time=${cursorSec}`;
    }

    calEl.querySelectorAll('[data-cal-view]').forEach((btn) => {
      const isActive = btn.dataset.calView === view;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });

    let rangeDates = [];
    if (view === 'day') {
      rangeDates = [cursor];
    } else if (view === 'week') {
      const weekStart = calGetWeekStart(cursor);
      for (let i = 0; i < 7; i++) {
        rangeDates.push(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i, 12, 0, 0));
      }
    } else {
      const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12, 0, 0);
      const leadingDays = (firstOfMonth.getDay() + 6) % 7;
      const gridStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - leadingDays, 12, 0, 0);
      const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const cellCount = leadingDays + daysInMonth > 35 ? 42 : 35;
      for (let i = 0; i < cellCount; i++) {
        rangeDates.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i, 12, 0, 0));
      }
    }

    ensureCalendarRangeLoaded(rangeDates);
    const eventsByDay = collectMergedCalendarEventsByDay(rangeDates);

    if (view === 'day') {
      bodyEl.innerHTML = renderCalendarDayHtml(cursor, todayKey, eventsByDay);
    } else if (view === 'week') {
      bodyEl.innerHTML = renderCalendarWeekHtml(rangeDates, todayKey, eventsByDay);
    } else {
      bodyEl.innerHTML = renderCalendarMonthHtml(rangeDates, cursor.getMonth(), todayKey, eventsByDay);
    }
  }

  function renderCalendarMonthHtml(cells, activeMonthIndex, todayKey, eventsByDay) {
    const headerHtml = CAL_WEEKDAY_SHORT.map((shortName, idx) => `
      <div class="mp-cal-weekday" title="${CAL_WEEKDAY_FULL[idx]}">${shortName}</div>
    `).join('');

    const cellsHtml = cells.map((d) => {
      const key = calDayKey(d);
      const isOutside = d.getMonth() !== activeMonthIndex;
      const isToday = key === todayKey;
      const dayEvents = eventsByDay.get(key) || [];
      const visible = dayEvents.slice(0, 3);
      const extraCount = dayEvents.length - visible.length;

      return `
        <div class="mp-cal-day-cell ${isOutside ? 'is-outside' : ''} ${isToday ? 'is-today' : ''}">
          <div class="mp-cal-day-top">
            <button type="button" class="mp-cal-day-num tabular" data-cal-goto-day="${key}" title="Napi nézet: ${key}">
              ${d.getDate()}
            </button>
            ${dayEvents.length > 0 ? `<span class="mp-cal-day-dot" aria-hidden="true"></span>` : ''}
          </div>
          <div class="mp-cal-day-events">
            ${visible.map((ev) => {
              const tStr = calFormatTimeHu(ev.timestamp);
              const tip = `${tStr ? tStr + ' — ' : ''}${ev.name}${ev.courseName ? ' (' + ev.courseName + ')' : ''}`;
              return `
                <a href="${escapeAttr(ev.url)}" class="mp-cal-event-pill" title="${escapeAttr(tip)}">
                  ${tStr ? `<span class="mp-cal-ev-time tabular">${escapeHtml(tStr)}</span>` : ''}
                  <span class="mp-cal-ev-name">${escapeHtml(ev.name)}</span>
                </a>
              `;
            }).join('')}
            ${extraCount > 0 ? `
              <button type="button" class="mp-cal-more-btn tabular" data-cal-goto-day="${key}" title="Összes esemény megtekintése ezen a napon">
                +${extraCount} további
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="mp-cal-month-grid" role="grid" aria-label="Havi naptár">
        ${headerHtml}
        ${cellsHtml}
      </div>
    `;
  }

  function renderCalendarWeekHtml(weekDays, todayKey, eventsByDay) {
    const shortFmt = new Intl.DateTimeFormat('hu-HU', { month: 'short', day: 'numeric' });
    return `
      <div class="mp-cal-week-list">
        ${weekDays.map((d, idx) => {
          const key = calDayKey(d);
          const isToday = key === todayKey;
          const dayEvents = eventsByDay.get(key) || [];
          return `
            <div class="mp-cal-week-row ${isToday ? 'is-today' : ''}">
              <div class="mp-cal-week-day-col">
                <button type="button" class="mp-cal-week-day-btn" data-cal-goto-day="${key}" title="Napi nézet megnyitása">
                  <span class="mp-cal-week-name">${CAL_WEEKDAY_FULL[idx]}</span>
                  <span class="mp-cal-week-date tabular">${escapeHtml(shortFmt.format(d))}</span>
                </button>
              </div>
              <div class="mp-cal-week-events">
                ${dayEvents.length === 0
                  ? '<span class="mp-cal-no-ev">Nincs esemény</span>'
                  : dayEvents.map((ev) => renderCalendarDetailItemHtml(ev)).join('')
                }
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderCalendarDayHtml(dayDate, todayKey, eventsByDay) {
    const key = calDayKey(dayDate);
    const isToday = key === todayKey;
    const dayEvents = eventsByDay.get(key) || [];

    return `
      <div class="mp-cal-day-detail">
        <div class="mp-cal-day-detail-hdr">
          <div class="mp-cal-day-detail-meta">
            <span class="mp-cal-day-detail-title">${escapeHtml(calFormatPeriodLabel('day', dayDate))}</span>
            ${isToday ? '<span class="mp-cal-today-tag">Ma</span>' : ''}
          </div>
          <span class="mp-search-badge tabular">${dayEvents.length} esemény</span>
        </div>
        ${dayEvents.length === 0
          ? '<p class="mp-cal-empty-note" style="padding:14px 4px;">Nincs esemény vagy határidő ezen a napon.</p>'
          : `<div class="mp-cal-detail-list">${dayEvents.map((ev) => renderCalendarDetailItemHtml(ev)).join('')}</div>`
        }
      </div>
    `;
  }

  function renderCalendarDetailItemHtml(ev) {
    const tStr = calFormatTimeHu(ev.timestamp);
    return `
      <div class="mp-cal-detail-item">
        <span class="mp-cal-detail-time tabular">${tStr ? escapeHtml(tStr) : '--:--'}</span>
        <div class="mp-cal-detail-info">
          <a href="${escapeAttr(ev.url)}" class="mp-cal-detail-link" title="${escapeAttr(ev.name)}">${escapeHtml(ev.name)}</a>
          ${ev.courseName ? `<span class="mp-cal-detail-course" title="${escapeAttr(ev.courseName)}">${escapeHtml(ev.courseName)}</span>` : ''}
        </div>
        ${ev.actionUrl && ev.actionUrl !== ev.url
          ? `<a href="${escapeAttr(ev.actionUrl)}" class="mp-btn" style="padding:3px 8px;flex-shrink:0;">${svgIcon('upload', 12)}<span>${escapeHtml(ev.actionName || 'Beadás')}</span></a>`
          : `<a href="${escapeAttr(ev.url)}" class="mp-btn" style="padding:3px 8px;flex-shrink:0;" title="${escapeAttr(ev.name)} megnyitása"><span>Megnyitás</span>${svgIcon('arrow-right', 12)}</a>`
        }
      </div>
    `;
  }

  function renderDeadlineCardHtml(d) {
    let badgeText = 'Esedékes';
    let badgeCls = '';
    if (d.timesort) {
      const diffHours = Math.round((d.timesort * 1000 - Date.now()) / 3600000);
      if (diffHours <= 0) {
        badgeText = 'Lejárt';
        badgeCls = 'urgent';
      } else if (diffHours < 24) {
        badgeText = `${diffHours} óra`;
        badgeCls = 'urgent';
      } else {
        const days = Math.ceil(diffHours / 24);
        badgeText = `${days} nap`;
        if (days <= 3) badgeCls = 'soon';
      }
    }

    return `
      <div class="mp-deadline-item">
        <div class="mp-deadline-top">
          <span class="mp-deadline-pill ${badgeCls}">${escapeHtml(badgeText)}</span>
          ${d.timesort ? `<span class="mp-deadline-date">${new Date(d.timesort * 1000).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>` : ''}
        </div>
        <a href="${escapeAttr(d.url)}" class="mp-deadline-title" title="${escapeAttr(d.name)}">${escapeHtml(d.name)}</a>
        ${d.courseName ? `<span class="mp-deadline-course" title="${escapeAttr(d.courseName)}">${escapeHtml(d.courseName)}</span>` : ''}
        ${d.actionUrl && d.actionUrl !== d.url ? `<a href="${escapeAttr(d.actionUrl)}" class="mp-btn" style="padding:3px 8px;align-self:flex-start;">${svgIcon('upload', 12)}<span>${escapeHtml(d.actionName || 'Beadás')}</span></a>` : ''}
      </div>
    `;
  }

  // --------------------------------------------------------------------------
  // 8. Course Page Overhaul & Deep Activity Unwrapper (/course/view.php)
  // --------------------------------------------------------------------------
  function initCourseOverhaul() {
    const regionMain = document.getElementById('region-main');
    if (!regionMain) return;
    document.body.setAttribute('data-mp-page', 'course');

    const courseTitle = document.querySelector('#page-header h1, .page-header-headings h1')?.textContent.trim()
      || document.title.replace(/^Kurzus:\s*/i, '').replace(/\s*\|\s*[^|]+$/i, '').trim();

    if (!document.getElementById('mp-course-hero')) {
      const hero = document.createElement('div');
      hero.id = 'mp-course-hero';
      hero.innerHTML = `
        <div class="mp-course-hero-top">
          <div>
            <a href="${escapeAttr(moodleUrl('/my/'))}" class="mp-back-link">${svgIcon('arrow-left', 13)}<span>Vissza az Irányítópultra</span></a>
            <h1 class="mp-course-hero-title">${escapeHtml(courseTitle)}</h1>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="mp-btn" id="mp-course-expand-all">${svgIcon('chevron-down', 13)}<span>Mindet Kinyit</span></button>
            <button type="button" class="mp-btn" id="mp-course-collapse-all">${svgIcon('chevron-up', 13)}<span>Mindet Becsuk</span></button>
          </div>
        </div>
        <div class="mp-course-controls">
          <div class="mp-search-wrapper" style="padding:5px 10px;max-width:340px;">
            ${svgIcon('search', 13)}
            <input type="text" id="mp-course-act-search" class="mp-search-input" placeholder="Keresés a tananyagok között..." aria-label="Keresés a tananyagok között" />
          </div>
          <div class="mp-cat-chips" id="mp-course-type-filters">
            <button type="button" class="mp-chip active" data-type="all">Minden</button>
            <button type="button" class="mp-chip" data-type="supervideo">Videók</button>
            <button type="button" class="mp-chip" data-type="resource">Fájlok</button>
            <button type="button" class="mp-chip" data-type="assign">Feladatok</button>
            <button type="button" class="mp-chip" data-type="folder">Mappák</button>
            <button type="button" class="mp-chip" data-type="url">Linkek</button>
          </div>
        </div>
      `;
      regionMain.insertBefore(hero, regionMain.firstChild);

      hero.querySelector('#mp-course-expand-all').addEventListener('click', () => {
        document.querySelectorAll('li.section a[data-for="sectiontoggler"][aria-expanded="false"], li.section button[aria-expanded="false"], .course-section-header a[aria-expanded="false"]').forEach((el) => el.click());
      });

      hero.querySelector('#mp-course-collapse-all').addEventListener('click', () => {
        document.querySelectorAll('li.section a[data-for="sectiontoggler"][aria-expanded="true"], li.section button[aria-expanded="true"], .course-section-header a[aria-expanded="true"]').forEach((el) => el.click());
      });

      hero.querySelector('#mp-course-act-search').addEventListener('input', filterCourseActivities);

      hero.querySelectorAll('#mp-course-type-filters .mp-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          hero.querySelectorAll('#mp-course-type-filters .mp-chip').forEach((c) => c.classList.remove('active'));
          chip.classList.add('active');
          activeCourseFilter = chip.dataset.type;
          filterCourseActivities();
        });
      });
    }

    unwrapCourseActivities();
  }

  function isCourseFilterActive() {
    const q = (document.getElementById('mp-course-act-search')?.value || '').trim();
    return Boolean(q) || activeCourseFilter !== 'all';
  }

  function filterCourseActivities() {
    const q = (document.getElementById('mp-course-act-search')?.value || '').toLowerCase().trim();
    const filtering = isCourseFilterActive();
    document.querySelectorAll('li.activity').forEach((act) => {
      const text = (act.querySelector('.activityname, .instancename, .activity-name-area')?.textContent || act.textContent).toLowerCase();
      const modType = getActivityModType(act);
      const qOk = !q || text.includes(q);
      const typeOk = activeCourseFilter === 'all' || modType === activeCourseFilter;
      act.classList.toggle('mp-filtered-out', !(qOk && typeOk));
    });
    document.querySelectorAll('li.section').forEach((sec) => {
      const acts = sec.querySelectorAll('li.activity');
      const anyVisible = Array.from(acts).some((a) => !a.classList.contains('mp-filtered-out'));
      sec.classList.toggle('mp-filtered-out', filtering && !anyVisible);
    });
  }

  function getActivityModType(act) {
    for (const t of ['supervideo', 'resource', 'folder', 'assign', 'url', 'page', 'quiz', 'forum']) {
      if (act.classList.contains(`modtype_${t}`) || act.classList.contains(t)) return t;
    }
    const link = act.querySelector('a[href*="/mod/"]');
    const m = link?.getAttribute('href')?.match(/\/mod\/([a-z0-9_-]+)\//);
    return m ? m[1] : 'other';
  }

  function getModIconName(modType) {
    const map = {
      assign: 'upload',
      resource: 'file',
      folder: 'folder',
      supervideo: 'video',
      url: 'external-link',
      quiz: 'check',
      forum: 'users',
      page: 'book',
      lti: 'compass',
      choice: 'check'
    };
    return map[modType] || 'book';
  }

  function enhanceActivityIconContainer(container, modType) {
    if (!container) return;
    const iconBox = container.querySelector('.activityiconcontainer');
    if (iconBox) {
      if (iconBox.dataset.mpIconReplaced === 'true') return;
      iconBox.dataset.mpIconReplaced = 'true';
      iconBox.innerHTML = `<span class="mp-act-icon-badge" data-mod-type="${escapeAttr(modType)}" aria-hidden="true">${svgIcon(getModIconName(modType), 15)}</span>`;
      return;
    }
    const legacyImg = container.querySelector('img.activityicon');
    if (legacyImg && !legacyImg.dataset.mpIconReplaced) {
      legacyImg.dataset.mpIconReplaced = 'true';
      const badge = document.createElement('span');
      badge.className = 'mp-act-icon-badge';
      badge.setAttribute('data-mod-type', modType);
      badge.setAttribute('aria-hidden', 'true');
      badge.innerHTML = svgIcon(getModIconName(modType), 15);
      legacyImg.replaceWith(badge);
    }
  }

  function unwrapCourseActivities() {
    const activities = Array.from(document.querySelectorAll('li.activity'));
    const tasks = [];

    activities.forEach((act) => {
      const modType = getActivityModType(act);
      enhanceActivityIconContainer(act, modType);

      if (act.dataset.mpProcessed === 'true') return;
      act.dataset.mpProcessed = 'true';

      const link = act.querySelector('a.aal_full, a.activityname, a.stretched-link, a[href*="/mod/"]');
      if (!link) return;

      const href = link.href;
      const title = link.textContent.replace(/\s+/g, ' ').trim() || 'Tananyag';
      const itemContainer = act.querySelector('.activity-item') || act;

      const actionsBar = document.createElement('div');
      actionsBar.className = 'mp-activity-actions';
      itemContainer.appendChild(actionsBar);

      if (modType === 'resource') {
        const directView = `${href}${href.includes('?') ? '&' : '?'}redirect=1`;
        unwrappedMediaMap.set(href, {
          title,
          sourceType: 'resource',
          canDownload: true,
          downloadUrl: directView,
          viewUrl: directView
        });

        actionsBar.innerHTML = `
          <a href="${escapeAttr(directView)}" target="_blank" rel="noopener noreferrer" class="mp-btn">${svgIcon('eye', 13)}<span>Megnyitás</span></a>
          <button type="button" class="mp-btn mp-btn-success mp-res-dl-btn">${svgIcon('download', 13)}<span>Letöltés</span></button>
        `;
        actionsBar.querySelectorAll('a, button').forEach((el) => {
          el.addEventListener('click', (e) => e.stopPropagation());
        });
        actionsBar.querySelector('.mp-res-dl-btn').addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          showToast('Fájl letöltésének indítása...');
          try {
            const r = await fetch(directView, { method: 'HEAD', credentials: 'same-origin' });
            const resolved = r.url || directView;
            const dl = resolved.includes('pluginfile.php')
              ? `${resolved}${resolved.includes('?') ? '&' : '?'}forcedownload=1`
              : directView;
            triggerDownload(dl);
          } catch (_) {
            triggerDownload(directView);
          }
        });
      } else if (['supervideo', 'folder', 'assign', 'url'].includes(modType)) {
        if (state.autoUnwrap) {
          tasks.push(() => fetchAndRenderActivityDetails(act, itemContainer, actionsBar, link, href, modType, title));
        } else {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'mp-btn';
          btn.innerHTML = `${svgIcon('bolt', 13)}<span>Kibontás helyben</span>`;
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            btn.disabled = true;
            btn.textContent = 'Betöltés...';
            fetchAndRenderActivityDetails(act, itemContainer, actionsBar, link, href, modType, title);
          });
          actionsBar.appendChild(btn);
        }
      }
    });

    runWithConcurrency(tasks, 4);
  }

  async function runWithConcurrency(tasks, limit) {
    let idx = 0;
    async function worker() {
      while (idx < tasks.length) {
        const current = tasks[idx++];
        try { await current(); } catch (_) {}
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  }

  async function fetchAndRenderActivityDetails(act, itemContainer, actionsBar, mainLink, href, modType, title) {
    const resp = await fetch(href, { credentials: 'same-origin' });
    if (!resp.ok) return;
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    actionsBar.innerHTML = '';

    if (modType === 'supervideo') {
      const media = extractVideoSourceFromHtml(html, doc);
      if (!media) {
        actionsBar.innerHTML = `<a href="${escapeAttr(href)}" class="mp-btn mp-btn-primary">${svgIcon('video', 13)}<span>Videó megnyitása</span></a>`;
        return;
      }

      unwrappedMediaMap.set(href, {
        title,
        sourceType: media.type,
        canDownload: media.type !== 'youtube',
        downloadUrl: media.type !== 'youtube' ? media.downloadUrl : '',
        viewUrl: media.viewUrl,
        mediaObj: media
      });

      const drawer = document.createElement('div');
      drawer.className = 'mp-inline-drawer mp-hidden';
      itemContainer.appendChild(drawer);

      actionsBar.innerHTML = `
        <button type="button" class="mp-btn mp-btn-primary mp-inline-play-btn">${svgIcon('play', 13)}<span>Lejátszás helyben</span></button>
        ${media.type === 'drive' ? `
          <button type="button" class="mp-btn mp-btn-success mp-drive-dl-btn">${svgIcon('download', 13)}<span>Letöltés (.mkv/.mp4)</span></button>
          <a href="${escapeAttr(media.viewUrl)}" target="_blank" rel="noopener noreferrer" class="mp-btn">${svgIcon('external-link', 13)}<span>Drive</span></a>
        ` : media.type === 'youtube' ? `
          <button type="button" class="mp-btn mp-btn-success mp-yt-dl-btn">${svgIcon('download', 13)}<span>Letöltés</span></button>
          <a href="${escapeAttr(media.viewUrl)}" target="_blank" rel="noopener noreferrer" class="mp-btn">${svgIcon('external-link', 13)}<span>YouTube</span></a>
        ` : `
          <button type="button" class="mp-btn mp-btn-success mp-mp4-dl-btn">${svgIcon('download', 13)}<span>Letöltés</span></button>
        `}
        <a href="${escapeAttr(href)}" class="mp-btn">${svgIcon('tv', 13)}<span>Mozi mód</span></a>
      `;

      actionsBar.querySelectorAll('a, button').forEach((el) => {
        el.addEventListener('click', (e) => e.stopPropagation());
      });

      const playBtn = actionsBar.querySelector('.mp-inline-play-btn');
      playBtn.addEventListener('click', () => {
        const hidden = drawer.classList.contains('mp-hidden');
        if (hidden) {
          drawer.classList.remove('mp-hidden');
          playBtn.innerHTML = `${svgIcon('square', 13)}<span>Bezárás</span>`;
          if (!drawer.dataset.loaded) {
            drawer.dataset.loaded = 'true';
            if (media.type === 'html5') {
              drawer.innerHTML = `<div class="mp-inline-player-wrap"><video controls autoplay src="${escapeAttr(media.embedUrl)}"></video></div>`;
            } else {
              drawer.innerHTML = `<div class="mp-inline-player-wrap"><iframe src="${escapeAttr(media.embedUrl)}" allowfullscreen allow="autoplay; fullscreen; picture-in-picture"></iframe></div>`;
            }
          }
        } else {
          drawer.classList.add('mp-hidden');
          playBtn.innerHTML = `${svgIcon('play', 13)}<span>Lejátszás helyben</span>`;
        }
      });

      actionsBar.querySelector('.mp-drive-dl-btn')?.addEventListener('click', () => {
        showToast('Google Drive videó letöltése indítva');
        triggerDownload(media.downloadUrl);
      });
      actionsBar.querySelector('.mp-yt-dl-btn')?.addEventListener('click', () => {
        openDownloadOptionsModal(media.viewUrl, title);
      });
      actionsBar.querySelector('.mp-mp4-dl-btn')?.addEventListener('click', () => {
        triggerDownload(media.downloadUrl);
      });
    } else if (modType === 'folder') {
      const files = [];
      doc.querySelectorAll('a[href*="pluginfile.php"]').forEach((a) => {
        const rawUrl = a.href;
        const viewUrl = rawUrl.replace(/[?&]forcedownload=1/, '');
        const dlUrl = viewUrl.includes('?') ? `${viewUrl}&forcedownload=1` : `${viewUrl}?forcedownload=1`;
        const name = a.textContent.trim() || viewUrl.split('/').pop().split('?')[0];
        files.push({ name, viewUrl, dlUrl });
        unwrappedMediaMap.set(dlUrl, {
          title: name,
          sourceType: 'file',
          canDownload: true,
          downloadUrl: dlUrl,
          viewUrl,
          filename: name
        });
      });

      const folderIdInput = doc.querySelector('form[action*="download_folder.php"] input[name="id"]');
      const zipAction = doc.querySelector('form[action*="download_folder.php"]')?.getAttribute('action');

      actionsBar.innerHTML = `
        <button type="button" class="mp-btn mp-btn-primary mp-folder-toggle-btn">${svgIcon('folder', 13)}<span>Fájlok (${files.length})</span></button>
        ${folderIdInput && zipAction ? `<button type="button" class="mp-btn mp-folder-zip-btn">${svgIcon('archive', 13)}<span>Mappa ZIP</span></button>` : ''}
      `;

      const drawer = document.createElement('div');
      drawer.className = 'mp-inline-drawer mp-hidden';
      drawer.innerHTML = `<div class="mp-inline-file-list">${files.map((f) => `
        <div class="mp-inline-file-row">
          <span class="mp-inline-file-name" title="${escapeAttr(f.name)}">${svgIcon('file', 13)}<span>${escapeHtml(f.name)}</span></span>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <a href="${escapeAttr(f.viewUrl)}" target="_blank" rel="noopener noreferrer" class="mp-btn" style="padding:3px 7px;">${svgIcon('eye', 12)}<span>Megnyitás</span></a>
            <button type="button" class="mp-btn mp-btn-success mp-file-dl" data-url="${escapeAttr(f.dlUrl)}" data-name="${escapeAttr(f.name)}" style="padding:3px 7px;">${svgIcon('download', 12)}<span>Letöltés</span></button>
          </div>
        </div>
      `).join('')}</div>`;
      itemContainer.appendChild(drawer);

      actionsBar.querySelector('.mp-folder-toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        drawer.classList.toggle('mp-hidden');
      });

      if (folderIdInput && zipAction) {
        actionsBar.querySelector('.mp-folder-zip-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          const zipUrl = `${zipAction}?id=${encodeURIComponent(folderIdInput.value)}`;
          triggerDownload(zipUrl);
        });
      }

      drawer.querySelectorAll('.mp-file-dl').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          triggerDownload(btn.dataset.url, btn.dataset.name);
        });
      });
    } else if (modType === 'assign') {
      const attachments = [];
      doc.querySelectorAll('.fileuploadsubmission a[href*="pluginfile.php"], #intro a[href*="pluginfile.php"]').forEach((a) => {
        const dlUrl = a.href;
        const name = a.textContent.trim() || 'Melléklet';
        attachments.push({ name, dlUrl });
        unwrappedMediaMap.set(dlUrl, {
          title: name,
          sourceType: 'file',
          canDownload: true,
          downloadUrl: dlUrl,
          viewUrl: dlUrl,
          filename: name
        });
      });

      const submitUrl = `${href}${href.includes('?') ? '&' : '?'}action=editsubmission`;
      actionsBar.innerHTML = `
        ${attachments.map((att) => `
          <button type="button" class="mp-btn mp-btn-attachment mp-assign-dl" data-url="${escapeAttr(att.dlUrl)}" data-name="${escapeAttr(att.name)}">${svgIcon('download', 13)}<span>${escapeHtml(att.name)}</span></button>
        `).join('')}
        <a href="${escapeAttr(submitUrl)}" class="mp-btn mp-btn-primary">${svgIcon('upload', 13)}<span>Beadás</span></a>
      `;

      actionsBar.querySelectorAll('a, button').forEach((el) => {
        el.addEventListener('click', (e) => e.stopPropagation());
      });
      actionsBar.querySelectorAll('.mp-assign-dl').forEach((btn) => {
        btn.addEventListener('click', () => triggerDownload(btn.dataset.url, btn.dataset.name));
      });
    } else if (modType === 'url') {
      const currentHost = window.location.hostname;
      const extLink = Array.from(doc.querySelectorAll('.urlworkaround a, #region-main a[href^="http"]'))
        .find((a) => {
          try { return new URL(a.href).hostname !== currentHost; } catch (_) { return false; }
        });

      if (extLink && extLink.href) {
        let host = extLink.href;
        try { host = new URL(extLink.href).hostname; } catch (_) {}
        actionsBar.innerHTML = `<a href="${escapeAttr(extLink.href)}" target="_blank" rel="noopener noreferrer" class="mp-btn mp-btn-primary">${svgIcon('external-link', 13)}<span>Megnyitás (${escapeHtml(host)})</span></a>`;
        actionsBar.querySelector('a').addEventListener('click', (e) => e.stopPropagation());
        mainLink.href = extLink.href;
        mainLink.target = '_blank';
        mainLink.rel = 'noopener noreferrer';
      }
    }
  }

  // --------------------------------------------------------------------------
  // 8B. Assignment & Activity Module Page Overhaul (/mod/* excluding SuperVideo)
  // --------------------------------------------------------------------------
  function enhanceModuleFileLinks() {
    document.querySelectorAll('#region-main .fileuploadsubmission a[href*="pluginfile.php"], #region-main .submissionstatustable a[href*="pluginfile.php"], #region-main #intro a[href*="pluginfile.php"]').forEach((link) => {
      if (link.closest('#mp-module-header')) return;
      link.classList.add('mp-file-pill');
      if (link.dataset.mpFileEnhanced !== 'true') {
        link.dataset.mpFileEnhanced = 'true';
        const iconSpan = document.createElement('span');
        iconSpan.className = 'mp-file-pill-icon';
        iconSpan.setAttribute('aria-hidden', 'true');
        iconSpan.innerHTML = svgIcon('file', 13);
        link.insertBefore(iconSpan, link.firstChild);
      }
    });
  }

  function initModulePageOverhaul() {
    const path = window.location.pathname;
    if (!path.includes('/mod/') || path.includes('/mod/supervideo/')) return;

    const regionMain = document.getElementById('region-main');
    if (!regionMain) return;

    if (!document.getElementById('mp-module-header')) {
      const courseLinkEl = document.querySelector('.breadcrumb a[href*="/course/view.php"], #page-navbar a[href*="/course/view.php"], a[href*="/course/view.php?id="]');
      const backHref = courseLinkEl?.href || moodleUrl('/my/');
      const backLabel = courseLinkEl?.textContent?.replace(/\s+/g, ' ').trim() || 'Vissza a kurzushoz';
      const activityTitle = document.querySelector('#page-header h1, .page-header-headings h1')?.textContent?.replace(/\s+/g, ' ').trim()
        || document.title.replace(/\s*\|\s*[^|]+$/i, '').trim()
        || 'Tevékenység';
      const modMatch = path.match(/\/mod\/([a-z0-9_-]+)\//);
      const modType = modMatch ? modMatch[1] : 'assign';

      const datesSet = new Set();
      document.querySelectorAll('.activity-header [data-region="activity-dates"] > div, #page-header [data-region="activity-dates"] > div, [data-region="activity-dates"] div').forEach((el) => {
        if (el.children.length > 0 && el.querySelector('div')) return;
        const txt = el.textContent.replace(/\s+/g, ' ').trim();
        if (txt) datesSet.add(txt);
      });
      const datesList = Array.from(datesSet);

      const fileMap = new Map();
      document.querySelectorAll('.activity-header a[href*="pluginfile.php"], [data-region="activity-information"] a[href*="pluginfile.php"]').forEach((a) => {
        if (a.closest('.submissionstatustable, #intro, .activity-description')) return;
        const url = a.href;
        const name = a.textContent.replace(/\s+/g, ' ').trim() || url.split('/').pop().split('?')[0] || 'Melléklet';
        if (url && !fileMap.has(url)) {
          fileMap.set(url, { url, name });
        }
      });
      const introFiles = Array.from(fileMap.values());

      const modHdr = document.createElement('div');
      modHdr.id = 'mp-module-header';
      modHdr.innerHTML = `
        <div class="mp-course-hero-top">
          <div style="min-width:0;flex:1;">
            <a href="${escapeAttr(backHref)}" class="mp-back-link" title="${escapeAttr(backLabel)}">${svgIcon('arrow-left', 13)}<span>Vissza: ${escapeHtml(backLabel)}</span></a>
            <div class="mp-mod-title-row">
              <span class="mp-act-icon-badge" data-mod-type="${escapeAttr(modType)}" aria-hidden="true">${svgIcon(getModIconName(modType), 16)}</span>
              <h1 class="mp-course-hero-title">${escapeHtml(activityTitle)}</h1>
            </div>
          </div>
        </div>
        ${(datesList.length > 0 || introFiles.length > 0) ? `
          <div class="mp-mod-meta-bar">
            ${datesList.map((txt) => `
              <span class="mp-mod-date-pill tabular">${svgIcon('clock', 12)}<span>${escapeHtml(txt)}</span></span>
            `).join('')}
            ${introFiles.map((f) => `
              <button type="button" class="mp-btn mp-btn-attachment mp-mod-quick-dl" data-url="${escapeAttr(f.url)}" data-name="${escapeAttr(f.name)}" title="${escapeAttr(f.name)} letöltése">
                ${svgIcon('download', 13)}<span>${escapeHtml(f.name)}</span>
              </button>
            `).join('')}
          </div>
        ` : ''}
      `;
      regionMain.insertBefore(modHdr, regionMain.firstChild);

      modHdr.querySelectorAll('.mp-mod-quick-dl').forEach((btn) => {
        btn.addEventListener('click', () => triggerDownload(btn.dataset.url, btn.dataset.name));
      });
    }

    document.body.classList.add('mp-mod-has-header');
    enhanceModuleFileLinks();
  }

  function extractVideoSourceFromHtml(html, doc) {
    if (doc) {
      const driveIf = doc.querySelector('iframe[src*="drive.google.com/file/d/"]');
      if (driveIf) {
        const m = driveIf.src.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (m) return buildDriveMedia(m[1]);
      }
      const ytIf = doc.querySelector('iframe[src*="youtube.com/embed"]');
      if (ytIf) {
        const m = ytIf.src.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
        if (m) return buildYouTubeMedia(m[1]);
      }
      const vid = doc.querySelector('video source, video');
      if (vid && (vid.src || vid.getAttribute('src'))) {
        const s = vid.src || vid.getAttribute('src');
        return { type: 'html5', embedUrl: s, downloadUrl: s, viewUrl: s };
      }
    }

    const driveMatch = html.match(/drive\.google\.com(?:\\\/|\/)(?:file(?:\\\/|\/)d(?:\\\/|\/)|open\?id=)([a-zA-Z0-9_-]{15,})/);
    if (driveMatch) return buildDriveMedia(driveMatch[1]);

    const ytMatch = html.match(/(?:youtube\.com(?:\\\/|\/)(?:embed(?:\\\/|\/)|watch\?v=)|youtu\.be(?:\\\/|\/))([a-zA-Z0-9_-]{11})/);
    if (ytMatch) return buildYouTubeMedia(ytMatch[1]);

    const mp4Match = html.match(/(https?:\/\/[^\s"'\\<>]+\.(?:mp4|webm|mkv|m4v)(?:\?[^\s"'\\<>]*)?)/i);
    if (mp4Match) {
      return { type: 'html5', embedUrl: mp4Match[1], downloadUrl: mp4Match[1], viewUrl: mp4Match[1] };
    }

    return null;
  }

  function buildDriveMedia(driveId) {
    return {
      type: 'drive',
      id: driveId,
      embedUrl: `https://drive.google.com/file/d/${driveId}/preview?controls=1&autoplay=0`,
      viewUrl: `https://drive.google.com/file/d/${driveId}/view`,
      downloadUrl: `https://drive.usercontent.google.com/download?id=${driveId}&export=download`
    };
  }

  function buildYouTubeMedia(videoId) {
    return {
      type: 'youtube',
      id: videoId,
      embedUrl: `https://www.youtube.com/embed/${videoId}?rel=0&controls=1`,
      viewUrl: `https://www.youtube.com/watch?v=${videoId}`,
      downloadUrl: `https://www.youtube.com/watch?v=${videoId}`
    };
  }

  // --------------------------------------------------------------------------
  // 9. SuperVideo Cinema Overhaul (/mod/supervideo/view.php)
  // --------------------------------------------------------------------------
  function initSuperVideoCinema() {
    const app = document.getElementById('app') || document.body;
    const stage = document.querySelector('main.stage') || document.getElementById('videoWrap')?.parentElement;
    const backHref = document.getElementById('btnBack')?.getAttribute('href') || moodleUrl('/my/');
    const videoTitle = document.getElementById('pageTitle')?.textContent.trim()
      || document.title.replace(/\s*\|\s*[^|]+$/i, '').trim();

    if (!document.getElementById('mp-cinema-header')) {
      const header = document.createElement('header');
      header.id = 'mp-cinema-header';
      header.innerHTML = `
        <div class="mp-cinema-left">
          <a href="${escapeAttr(backHref)}" class="mp-btn">${svgIcon('arrow-left', 13)}<span>Vissza</span></a>
          <span class="mp-badge" id="mp-cinema-badge">Videó</span>
          <h1 class="mp-cinema-title" title="${escapeAttr(videoTitle)}">${escapeHtml(videoTitle)}</h1>
        </div>
        <div class="mp-cinema-actions" id="mp-cinema-actions">
          <span style="font-size:12px;color:var(--mp-text-muted);">Videó felismerése...</span>
        </div>
      `;
      app.insertBefore(header, app.firstChild);
    }

    if (stage && !document.getElementById('mp-cinema-mobile-bar')) {
      const mobileBar = document.createElement('div');
      mobileBar.id = 'mp-cinema-mobile-bar';
      mobileBar.innerHTML = `
        <span style="font-size:12px;color:var(--mp-text-muted);">Ha a beágyazott lejátszó kis képernyőn nem indul el, töltsd le vagy nyisd meg külön lapon:</span>
        <div id="mp-cinema-mobile-btns" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
      `;
      stage.appendChild(mobileBar);
    }

    let resolved = false;
    const tryResolve = () => {
      if (resolved) return true;
      const wrap = document.getElementById('videoWrap');
      let media = null;

      if (wrap) {
        const driveIf = wrap.querySelector('iframe[src*="drive.google.com/file/d/"]');
        const ytIf = wrap.querySelector('iframe[src*="youtube.com/embed"], iframe[id^="youtube-"], #myVideo');
        const vid = wrap.querySelector('video');
        if (driveIf) {
          const m = driveIf.src.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
          if (m) media = buildDriveMedia(m[1]);
        } else if (ytIf && ytIf.src) {
          const m = ytIf.src.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
          if (m) media = buildYouTubeMedia(m[1]);
        } else if (vid && (vid.currentSrc || vid.src)) {
          const s = vid.currentSrc || vid.src;
          media = { type: 'html5', embedUrl: s, downloadUrl: s, viewUrl: s };
        }
      }

      if (!media) {
        media = extractVideoSourceFromHtml(document.documentElement.innerHTML, document);
      }

      if (media) {
        resolved = true;
        currentCinemaMedia = {
          title: videoTitle,
          sourceType: media.type,
          canDownload: media.type !== 'youtube',
          downloadUrl: media.type !== 'youtube' ? media.downloadUrl : '',
          viewUrl: media.viewUrl,
          mediaObj: media
        };
        populateCinemaActions(media, videoTitle);
        return true;
      }
      return false;
    };

    if (!tryResolve()) {
      let attempts = 0;
      clearInterval(window.__mpCinemaTimer);
      window.__mpCinemaTimer = setInterval(() => {
        attempts++;
        if (tryResolve() || attempts > 30) clearInterval(window.__mpCinemaTimer);
      }, 300);
    }
  }

  function populateCinemaActions(media, title) {
    const badge = document.getElementById('mp-cinema-badge');
    const actions = document.getElementById('mp-cinema-actions');
    const mobileBtns = document.getElementById('mp-cinema-mobile-btns');
    if (!actions) return;

    if (badge) {
      badge.className = `mp-badge ${media.type === 'drive' ? 'mp-badge-drive' : media.type === 'youtube' ? 'mp-badge-yt' : ''}`;
      badge.textContent = media.type === 'drive' ? 'Google Drive' : media.type === 'youtube' ? 'YouTube' : 'MP4';
    }

    actions.innerHTML = `
      <button type="button" class="mp-btn mp-btn-success" id="mp-cin-dl">${svgIcon('download', 13)}<span>Letöltés</span></button>
      ${media.type === 'drive' ? `
        <a href="${escapeAttr(media.viewUrl)}" target="_blank" rel="noopener noreferrer" class="mp-btn mp-btn-primary">${svgIcon('external-link', 13)}<span>Drive</span></a>
      ` : media.type === 'youtube' ? `
        <a href="${escapeAttr(media.viewUrl)}" target="_blank" rel="noopener noreferrer" class="mp-btn mp-btn-danger">${svgIcon('external-link', 13)}<span>YouTube</span></a>
      ` : `
        <a href="${escapeAttr(media.viewUrl)}" target="_blank" rel="noopener noreferrer" class="mp-btn mp-btn-primary">${svgIcon('external-link', 13)}<span>Új lap</span></a>
      `}
      <button type="button" class="mp-btn" id="mp-cin-copy">${svgIcon('copy', 13)}<span>Link</span></button>
      <button type="button" class="mp-btn" id="mp-cin-map">${svgIcon('map', 13)}<span>Térkép</span></button>
    `;

    if (mobileBtns) {
      mobileBtns.innerHTML = `
        <button type="button" class="mp-btn mp-btn-success" id="mp-mob-dl">${svgIcon('download', 13)}<span>Letöltés</span></button>
        <a href="${escapeAttr(media.viewUrl)}" target="_blank" rel="noopener noreferrer" class="mp-btn mp-btn-primary">${svgIcon('external-link', 13)}<span>Megnyitás</span></a>
      `;
      mobileBtns.querySelector('#mp-mob-dl').addEventListener('click', () => handleCinemaDownload(media, title));
    }

    actions.querySelector('#mp-cin-dl').addEventListener('click', () => handleCinemaDownload(media, title));
    actions.querySelector('#mp-cin-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(media.viewUrl).then(() => showToast('Videó link másolva a vágólapra'));
    });
    actions.querySelector('#mp-cin-map').addEventListener('click', () => {
      const mapEl = document.getElementById('map-visualization');
      if (mapEl) {
        mapEl.classList.toggle('mp-show-map');
        showToast(mapEl.classList.contains('mp-show-map') ? 'Megtekintési térkép látható' : 'Térkép elrejtve');
      } else {
        showToast('Ehhez a videóhoz nincs térkép');
      }
    });
  }

  function handleCinemaDownload(media, title) {
    if (media.type === 'youtube') {
      openDownloadOptionsModal(media.viewUrl, title);
    } else {
      showToast('Videó letöltése indítva');
      triggerDownload(media.downloadUrl);
    }
  }

  // --------------------------------------------------------------------------
  // 10. Shadow DOM Lightbox, Modals, Toasts & Download Bridge
  // --------------------------------------------------------------------------
  function initImageLightbox() {
    document.querySelectorAll('.activity-item img, .content img, .description img, .summary img, #region-main img').forEach((img) => {
      if (img.closest('#mp-overhaul-dashboard, .login-logo')) return;
      if (img.width > 0 && img.width < 50 && img.height > 0 && img.height < 50) return;
      if (img.classList.contains('activityicon') || img.classList.contains('userpicture')) return;
      if (img.dataset.mpZoom === 'true') return;
      img.dataset.mpZoom = 'true';
      img.classList.add('moodle-plus-zoomable');
      img.title = 'Kattints a nagyításhoz';
      img.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openImageLightbox(img.src, img.alt || 'Kép');
      });
    });
  }

  function openImageLightbox(src, alt) {
    ensureShadowShell();
    const modalRoot = shadowRoot.getElementById('mp-modal-root');
    if (!modalRoot) return;
    modalRoot.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.id = 'moodle-plus-lightbox';
    overlay.className = 'mp-modal-overlay';
    overlay.innerHTML = `
      <button type="button" class="mp-lightbox-close" title="Bezárás (Esc)" aria-label="Bezárás">${svgIcon('x', 16)}</button>
      <img src="${escapeAttr(src)}" class="mp-lightbox-img" alt="${escapeAttr(alt)}" />
      <div class="mp-lightbox-bar">
        <button type="button" class="mp-btn mp-btn-success" id="mp-lb-dl">${svgIcon('download', 13)}<span>Kép letöltése</span></button>
        <a href="${escapeAttr(src)}" target="_blank" rel="noopener noreferrer" class="mp-btn">${svgIcon('external-link', 13)}<span>Teljes méret</span></a>
      </div>
    `;
    modalRoot.appendChild(overlay);

    overlay.querySelector('#mp-lb-dl').addEventListener('click', () => triggerDownload(src));
    const close = () => { modalRoot.innerHTML = ''; };
    overlay.querySelector('.mp-lightbox-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  function openDownloadOptionsModal(url, title) {
    ensureShadowShell();
    const modalRoot = shadowRoot.getElementById('mp-modal-root');
    if (!modalRoot) return;
    modalRoot.innerHTML = '';

    const ytDlpCmd = `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" "${url}"`;
    const cobaltUrl = `https://cobalt.tools/#${encodeURIComponent(url)}`;

    const overlay = document.createElement('div');
    overlay.id = 'mp-yt-modal';
    overlay.className = 'mp-modal-overlay';
    overlay.innerHTML = `
      <div class="mp-modal-box" role="dialog" aria-label="YouTube videó letöltése">
        <div class="mp-modal-header">
          <h3>${svgIcon('video', 14)}<span>YouTube Videó Letöltése</span></h3>
          <button type="button" class="mp-btn" id="mp-modal-close" aria-label="Bezárás">${svgIcon('x', 13)}</button>
        </div>
        <p style="font-size:12px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeAttr(title)}">${escapeHtml(title)}</p>
        <a href="${escapeAttr(cobaltUrl)}" target="_blank" rel="noopener noreferrer" class="mp-btn mp-btn-success" style="width:100%;height:32px;">${svgIcon('external-link', 13)}<span>Megnyitás Cobalt.tools letöltőben</span></a>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <span style="font-size:11px;font-weight:600;color:var(--text-muted);">YT-DLP parancs (maximum minőség)</span>
          <div class="mp-cmd-box">${escapeHtml(ytDlpCmd)}</div>
          <button type="button" class="mp-btn" id="mp-copy-ytdlp" style="width:100%;">${svgIcon('terminal', 13)}<span>Parancs másolása</span></button>
        </div>
      </div>
    `;
    modalRoot.appendChild(overlay);

    overlay.querySelector('#mp-copy-ytdlp').addEventListener('click', () => {
      navigator.clipboard.writeText(ytDlpCmd).then(() => showToast('yt-dlp parancs másolva'));
    });
    const close = () => { modalRoot.innerHTML = ''; };
    overlay.querySelector('#mp-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  function showToast(message) {
    ensureShadowShell();
    const container = shadowRoot.getElementById('mp-toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'mp-toast';
    toast.innerHTML = `${svgIcon('check', 13)}<span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 160ms ease-out, transform 160ms ease-out';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 180);
    }, 2600);
  }

  function triggerDownload(url, filename) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({ type: 'DOWNLOAD_FILE', url, filename }, (res) => {
          if (chrome.runtime.lastError || !res?.ok) {
            fallbackAnchorDownload(url, filename);
          }
        });
        return;
      } catch (_) {}
    }
    fallbackAnchorDownload(url, filename);
  }

  function fallbackAnchorDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    if (filename) a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function collectPageMedia() {
    const items = [];
    if (currentCinemaMedia) {
      items.push({
        title: currentCinemaMedia.title,
        sourceType: currentCinemaMedia.sourceType,
        canDownload: currentCinemaMedia.canDownload,
        downloadUrl: currentCinemaMedia.downloadUrl,
        viewUrl: currentCinemaMedia.viewUrl
      });
    } else if (window.location.pathname.includes('/mod/supervideo/')) {
      const m = extractVideoSourceFromHtml(document.documentElement.innerHTML, document);
      if (m) {
        const title = document.getElementById('pageTitle')?.textContent.trim()
          || document.title.replace(/\s*\|\s*[^|]+$/i, '').trim();
        items.push({
          title,
          sourceType: m.type,
          canDownload: m.type !== 'youtube',
          downloadUrl: m.type !== 'youtube' ? m.downloadUrl : '',
          viewUrl: m.viewUrl
        });
      }
    }

    unwrappedMediaMap.forEach((val) => {
      items.push({
        title: val.title,
        sourceType: val.sourceType,
        canDownload: val.canDownload,
        downloadUrl: val.downloadUrl,
        viewUrl: val.viewUrl,
        filename: val.filename
      });
    });

    return items;
  }

  function triggerPrimaryPageDownload() {
    if (currentCinemaMedia?.mediaObj) {
      handleCinemaDownload(currentCinemaMedia.mediaObj, currentCinemaMedia.title);
      return true;
    }
    const items = collectPageMedia();
    const downloadable = items.find((i) => i.downloadUrl);
    if (downloadable) {
      showToast(`Letöltés: ${downloadable.title}`);
      triggerDownload(downloadable.downloadUrl, downloadable.filename);
      return true;
    }
    const ytItem = Array.from(unwrappedMediaMap.values()).find((v) => v.mediaObj?.type === 'youtube');
    if (ytItem) {
      openDownloadOptionsModal(ytItem.viewUrl, ytItem.title);
      return true;
    }
    showToast('Nincs közvetlenül letölthető média ezen az oldalon');
    return false;
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>'"]/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[ch]));
  }

  // Single source of truth: manifest.json (the release workflow stamps it from the git tag)
  function getExtensionVersion() {
    try {
      return chrome.runtime.getManifest().version || '';
    } catch (_) {
      return '';
    }
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  // --------------------------------------------------------------------------
  // 11. Runtime Messages, Shortcuts & Boot Sequence
  // --------------------------------------------------------------------------
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'GET_PAGE_CONTEXT' || message?.type === 'GET_PAGE_MEDIA') {
        sendResponse({
          ok: true,
          origin: window.location.origin,
          wwwroot: getWwwroot(),
          hostname: window.location.hostname,
          siteTitle: getMoodleSiteLabel(),
          path: window.location.pathname,
          overhaulMode: Boolean(state.overhaulMode),
          logoutUrl: getLogoutUrl(),
          isLogin: isLoginRoute(),
          media: collectPageMedia()
        });
        return false;
      }
      if (message?.type === 'TRIGGER_PRIMARY_DOWNLOAD') {
        const triggered = triggerPrimaryPageDownload();
        sendResponse({ ok: triggered });
        return false;
      }
      if (message?.type === 'PERFORM_SIGN_OUT') {
        performSignOut();
        sendResponse({ ok: true });
        return false;
      }
      return false;
    });
  }

  function bindKeyboardShortcuts() {
    if (window.__mpKeyListener) {
      document.removeEventListener('keydown', window.__mpKeyListener);
    }
    window.__mpKeyListener = (e) => {
      if (e.key === 'Escape') {
        const modalRoot = shadowRoot?.getElementById('mp-modal-root');
        if (modalRoot && modalRoot.innerHTML.trim() !== '') {
          modalRoot.innerHTML = '';
          return;
        }
        const drawer = shadowRoot?.getElementById('mp-customizer-drawer');
        if (drawer?.classList.contains('open')) {
          toggleCustomizer(false);
          return;
        }
      }

      if (e.altKey && e.shiftKey) {
        const key = e.key.toLowerCase();
        if (key === 'm') {
          e.preventDefault();
          toggleOverhaulMode();
        } else if (key === 'k') {
          e.preventDefault();
          toggleCustomizer();
        } else if (key === 'd') {
          e.preventDefault();
          triggerPrimaryPageDownload();
        }
      }
    };
    document.addEventListener('keydown', window.__mpKeyListener);
  }

  window.__mpCleanup = () => {
    ['mp-shadow-host', 'mp-trigger-host', 'mp-sidebar', 'mp-mobile-topbar', 'mp-overhaul-dashboard', 'mp-course-hero', 'mp-module-header', 'mp-cinema-header', 'mp-cinema-mobile-bar', 'mp-login-header'].forEach((id) => {
      document.getElementById(id)?.remove();
    });
    document.body?.classList?.remove('mp-mod-has-header');
    document.documentElement.removeAttribute('data-mp-active');
    document.documentElement.removeAttribute('data-mp-scaled');
    document.querySelector('meta[name="darkreader-lock"][data-mp-owned="true"]')?.remove();
    if (window.__mpKeyListener) {
      document.removeEventListener('keydown', window.__mpKeyListener);
    }
    if (window.__mpResizeListener) {
      window.removeEventListener('resize', window.__mpResizeListener);
    }
    window.__mpObserver?.disconnect();
    clearInterval(window.__mpCinemaTimer);
  };

  // Moodle 5 also puts path-course-view on course sub-pages (participants is
  // page-course-view-participants), so body classes alone are not enough: the
  // course workspace is the course/section page that actually renders sections.
  function isCourseWorkspaceRoute() {
    const path = window.location.pathname;
    if (path.includes('/course/view.php') || path.includes('/course/section.php')) return true;
    const cls = document.body.classList;
    return (cls.contains('path-course-view') || cls.contains('path-course-section'))
      && /^page-course-(view-(weeks|topics|[a-z]+format)|section)/.test(document.body.id || '')
      && Boolean(document.querySelector('#region-main .course-content'));
  }

  async function boot() {
    await loadState();

    const origin = window.location.origin;
    const siteLabel = getMoodleSiteLabel();
    const wwwroot = getWwwroot();
    if (state.lastMoodleOrigin !== origin || state.lastMoodleTitle !== siteLabel || state.lastMoodleWwwroot !== wwwroot) {
      saveState({ lastMoodleOrigin: origin, lastMoodleWwwroot: wwwroot, lastMoodleTitle: siteLabel });
    }

    applyVisualSettings();
    initAppShell();
    bindKeyboardShortcuts();

    const path = window.location.pathname;
    if (isLoginRoute()) {
      initLoginOverhaul();
    } else if (path.includes('/mod/supervideo/') || document.body.classList.contains('path-mod-supervideo')) {
      initSuperVideoCinema();
    } else if (isCourseWorkspaceRoute()) {
      initCourseOverhaul();
    } else if (path.includes('/mod/')) {
      initModulePageOverhaul();
    } else if (path.includes('/my/') || path.includes('/my/courses.php') || document.body.classList.contains('path-my')) {
      initDashboardOverhaul();
    }

    if (!isLoginRoute()) {
      initImageLightbox();
      if (!path.includes('/mod/supervideo/')) {
        fetchMoodleData();
      }
    }

    if (window.__mpResizeListener) {
      window.removeEventListener('resize', window.__mpResizeListener);
    }
    window.__mpResizeListener = () => queueTriggerSync();
    window.addEventListener('resize', window.__mpResizeListener, { passive: true });

    const onCourseWorkspace = isCourseWorkspaceRoute();
    const onModulePage = path.includes('/mod/') && !path.includes('/mod/supervideo/');
    const OWN_NODE_SELECTOR = '#mp-shadow-host, #mp-trigger-host, #mp-sidebar, #mp-mobile-topbar, #mp-overhaul-dashboard, .mp-activity-actions, .mp-inline-drawer, #mp-course-hero, #mp-module-header, #mp-cinema-header';
    const isOwnNode = (node) => node.nodeType === 1 && Boolean(node.matches?.(OWN_NODE_SELECTOR) || node.closest?.(OWN_NODE_SELECTOR));

    let mutationQueued = false;
    const processMutations = () => {
      mutationQueued = false;
      if (isLoginRoute()) return;
      initImageLightbox();
      if (state.overhaulMode) {
        enhanceCourseSecondaryNav();
      }
      if (onCourseWorkspace) {
        unwrapCourseActivities();
        if (isCourseFilterActive()) filterCourseActivities();
      } else if (onModulePage) {
        enhanceModuleFileLinks();
      }
      syncTopRightTriggerPosition();
      if ((state.cachedCourses || []).length < 4) {
        const result = harvestDomCourses(state.cachedCourses || []);
        if (result.added > 0) {
          saveState({ cachedCourses: result.courses });
          renderSidebarCourses();
          renderDashboardHub();
        }
      }
    };

    window.__mpObserver?.disconnect();
    window.__mpObserver = new MutationObserver((records) => {
      const relevant = records.some((r) => {
        if (isOwnNode(r.target)) return false;
        const nodes = [...r.addedNodes, ...r.removedNodes];
        return nodes.length === 0 || nodes.some((n) => n.nodeType === 1 && !isOwnNode(n));
      });
      if (!relevant || mutationQueued) return;
      mutationQueued = true;
      requestAnimationFrame(processMutations);
    });
    window.__mpObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
