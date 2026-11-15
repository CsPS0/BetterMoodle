// ==========================================================================
// BetterMoodle - Options Page Script
// ==========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Version comes from the manifest (stamped from the release tag at build time)
  try {
    const versionEl = document.getElementById('optVersion');
    const version = chrome.runtime.getManifest().version;
    if (versionEl && version) {
      versionEl.textContent = `v${version}`;
      versionEl.hidden = false;
    }
  } catch (_) {}

  const DEFAULTS = {
    overhaulMode: true,
    uiScheme: 'auto',
    theme: 'midnight',
    customAccent: '',
    customBg: '',
    cardRadius: 8,
    uiScale: 100,
    navStyle: 'sidebar',
    courseNavStyle: 'icons',
    courseNavBg: '',
    viewMode: 'grid',
    density: 'normal',
    wallpaperUrl: '',
    autoUnwrap: true,
    hideCompletion: false,
    cachedCourses: [],
    cachedDeadlines: [],
    pinnedCourses: []
  };

  const hasChromeStorage = Boolean(
    typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local
  );

  async function readStorage(defaults) {
    if (hasChromeStorage) {
      return chrome.storage.local.get(defaults);
    }
    try {
      const raw = localStorage.getItem('bm_moodle_settings');
      if (raw) return { ...defaults, ...JSON.parse(raw) };
    } catch (_) {}
    return {
      ...defaults,
      cachedCourses: [
        { id: '166', title: 'Szoftverfejlesztési gyakorlatok' },
        { id: '142', title: 'Adatbázis-kezelő rendszerek' },
        { id: '188', title: 'Számítógép-hálózatok II.' }
      ],
      cachedDeadlines: [
        { id: '1', name: 'REST API beadandó' },
        { id: '2', name: 'SQL optimalizálás ZH' }
      ]
    };
  }

  async function writeStorage(patch) {
    if (hasChromeStorage) {
      await chrome.storage.local.set(patch);
      return;
    }
    try {
      const raw = localStorage.getItem('bm_moodle_settings');
      const cur = raw ? JSON.parse(raw) : {};
      localStorage.setItem('bm_moodle_settings', JSON.stringify({ ...cur, ...patch }));
    } catch (_) {}
  }

  let saveTimer = null;
  let settings = await readStorage(DEFAULTS);

  hydrateForm(settings);
  bindEvents();

  function applyUiScheme(scheme) {
    if (scheme === 'light' || scheme === 'dark') {
      document.documentElement.setAttribute('data-ui-scheme', scheme);
    } else {
      document.documentElement.removeAttribute('data-ui-scheme');
    }
  }

  function flashSaved(msg = 'Mentve') {
    const el = document.getElementById('saveStatus');
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => el.classList.remove('visible'), 1600);
  }

  async function persist(patch) {
    Object.assign(settings, patch);
    await writeStorage(patch);
    flashSaved();
  }

  function hydrateForm(s) {
    applyUiScheme(s.uiScheme);

    document.getElementById('optOverhaulMode').checked = Boolean(s.overhaulMode);
    document.getElementById('optAutoUnwrap').checked = Boolean(s.autoUnwrap);
    document.getElementById('optHideCompletion').checked = Boolean(s.hideCompletion);

    setSelectValue('optUiScheme', s.uiScheme, DEFAULTS.uiScheme);
    setSelectValue('optTheme', s.theme, DEFAULTS.theme);
    setSelectValue('optNavStyle', s.navStyle, DEFAULTS.navStyle);
    setSelectValue('optCourseNavStyle', s.courseNavStyle, DEFAULTS.courseNavStyle);
    setSelectValue('optDensity', s.density, DEFAULTS.density);

    const cnavVal = s.courseNavBg || '#121215';
    document.getElementById('optCourseNavBgPicker').value = isHexColor(cnavVal) ? cnavVal : '#121215';
    document.getElementById('optCourseNavBgHex').value = s.courseNavBg || '';

    const accentVal = s.customAccent || '#3b82f6';
    document.getElementById('optAccentPicker').value = isHexColor(accentVal) ? accentVal : '#3b82f6';
    document.getElementById('optAccentHex').value = s.customAccent || '';

    const bgVal = s.customBg || '#09090b';
    document.getElementById('optBgPicker').value = isHexColor(bgVal) ? bgVal : '#09090b';
    document.getElementById('optBgHex').value = s.customBg || '';

    const radius = Math.min(16, Math.max(0, Number(s.cardRadius ?? 8)));
    document.getElementById('optCardRadius').value = String(radius);
    document.getElementById('optRadiusVal').textContent = `${radius}px`;

    const scale = Math.min(125, Math.max(85, Number(s.uiScale ?? 100)));
    document.getElementById('optUiScale').value = String(scale);
    document.getElementById('optScaleVal').textContent = `${scale}%`;

    document.getElementById('optWallpaperUrl').value = s.wallpaperUrl || '';

    updateCacheStats();
  }

  function updateCacheStats() {
    const cCount = (settings.cachedCourses || []).length;
    const dCount = (settings.cachedDeadlines || []).length;
    document.getElementById('optCacheStats').textContent = `${cCount} kurzus, ${dCount} határidő tárolva`;
  }

  function setSelectValue(id, value, fallback) {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.value = [...sel.options].some((o) => o.value === value) ? value : fallback;
  }

  function isHexColor(str) {
    return /^#[0-9a-fA-F]{6}$/.test(String(str || '').trim());
  }

  function bindEvents() {
    document.getElementById('optOverhaulMode').addEventListener('change', (e) => persist({ overhaulMode: e.target.checked }));
    document.getElementById('optAutoUnwrap').addEventListener('change', (e) => persist({ autoUnwrap: e.target.checked }));
    document.getElementById('optHideCompletion').addEventListener('change', (e) => persist({ hideCompletion: e.target.checked }));

    document.getElementById('optUiScheme').addEventListener('change', (e) => {
      applyUiScheme(e.target.value);
      persist({ uiScheme: e.target.value });
    });

    document.getElementById('optTheme').addEventListener('change', (e) => {
      document.getElementById('optAccentHex').value = '';
      document.getElementById('optBgHex').value = '';
      persist({ theme: e.target.value, customAccent: '', customBg: '' });
    });

    document.getElementById('optNavStyle').addEventListener('change', (e) => persist({ navStyle: e.target.value }));
    document.getElementById('optCourseNavStyle').addEventListener('change', (e) => persist({ courseNavStyle: e.target.value }));

    const cnavBgPicker = document.getElementById('optCourseNavBgPicker');
    const cnavBgHex = document.getElementById('optCourseNavBgHex');
    cnavBgPicker.addEventListener('input', (e) => {
      cnavBgHex.value = e.target.value;
      persist({ courseNavBg: e.target.value });
    });
    cnavBgHex.addEventListener('change', (e) => {
      const val = e.target.value.trim();
      if (!val) {
        persist({ courseNavBg: '' });
      } else if (isHexColor(val)) {
        cnavBgPicker.value = val;
        persist({ courseNavBg: val });
      }
    });
    document.getElementById('optCourseNavBgReset').addEventListener('click', () => {
      cnavBgHex.value = '';
      cnavBgPicker.value = '#121215';
      persist({ courseNavBg: '' });
    });

    document.getElementById('optDensity').addEventListener('change', (e) => persist({ density: e.target.value }));

    const accentPicker = document.getElementById('optAccentPicker');
    const accentHex = document.getElementById('optAccentHex');
    accentPicker.addEventListener('input', (e) => {
      accentHex.value = e.target.value;
      persist({ customAccent: e.target.value });
    });
    accentHex.addEventListener('change', (e) => {
      const val = e.target.value.trim();
      if (!val) {
        persist({ customAccent: '' });
      } else if (isHexColor(val)) {
        accentPicker.value = val;
        persist({ customAccent: val });
      }
    });
    document.getElementById('optAccentReset').addEventListener('click', () => {
      accentHex.value = '';
      accentPicker.value = '#3b82f6';
      persist({ customAccent: '' });
    });

    const bgPicker = document.getElementById('optBgPicker');
    const bgHex = document.getElementById('optBgHex');
    bgPicker.addEventListener('input', (e) => {
      bgHex.value = e.target.value;
      persist({ customBg: e.target.value });
    });
    bgHex.addEventListener('change', (e) => {
      const val = e.target.value.trim();
      if (!val) {
        persist({ customBg: '' });
      } else if (isHexColor(val)) {
        bgPicker.value = val;
        persist({ customBg: val });
      }
    });
    document.getElementById('optBgReset').addEventListener('click', () => {
      bgHex.value = '';
      bgPicker.value = '#09090b';
      persist({ customBg: '' });
    });

    const radiusSlider = document.getElementById('optCardRadius');
    radiusSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      document.getElementById('optRadiusVal').textContent = `${val}px`;
      persist({ cardRadius: val });
    });

    const scaleSlider = document.getElementById('optUiScale');
    scaleSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      document.getElementById('optScaleVal').textContent = `${val}%`;
      persist({ uiScale: val });
    });

    document.getElementById('optWallpaperSave').addEventListener('click', () => {
      const url = document.getElementById('optWallpaperUrl').value.trim();
      persist({ wallpaperUrl: url });
    });

    document.getElementById('optClearCache').addEventListener('click', async () => {
      await persist({ cachedCourses: [], cachedDeadlines: [] });
      updateCacheStats();
      flashSaved('Gyorsítótár törölve');
    });

    document.getElementById('optResetAll').addEventListener('click', async () => {
      const resetPatch = {
        overhaulMode: true,
        uiScheme: 'auto',
        theme: 'midnight',
        customAccent: '',
        customBg: '',
        cardRadius: 8,
        uiScale: 100,
        navStyle: 'sidebar',
        courseNavStyle: 'icons',
        courseNavBg: '',
        viewMode: 'grid',
        density: 'normal',
        wallpaperUrl: '',
        autoUnwrap: true,
        hideCompletion: false
      };
      await persist(resetPatch);
      hydrateForm(settings);
      flashSaved('Alapértelmezés visszaállítva');
    });
  }
});
