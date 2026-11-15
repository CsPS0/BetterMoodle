// ==========================================================================
// BetterMoodle - Action Popup Script
// ==========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  const DEFAULT_VALUES = {
    uiScheme: 'auto',
    theme: 'midnight',
    density: 'normal',
    navStyle: 'sidebar',
    courseNavStyle: 'icons',
    courseNavBg: '',
    uiScale: 100,
    autoUnwrap: true,
    hideCompletion: false,
    cachedCourses: [],
    pinnedCourses: [],
    lastMoodleOrigin: '',
    lastMoodleWwwroot: ''
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
      lastMoodleOrigin: 'https://moodle.example.edu',
      pinnedCourses: ['166'],
      cachedCourses: [
        { id: '166', title: 'Szoftverfejlesztési gyakorlatok', category: 'Informatika', url: '#course-166', hasprogress: true, progress: 78 },
        { id: '142', title: 'Adatbázis-kezelő rendszerek', category: 'Adatbázisok', url: '#course-142', hasprogress: true, progress: 62 },
        { id: '188', title: 'Számítógép-hálózatok II.', category: 'Hálózatok', url: '#course-188', hasprogress: true, progress: 45 }
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

  let activeTab = null;
  let activeFilter = 'all';
  let pageMediaItems = [];
  let activePageContext = null;
  let settings = await readStorage(DEFAULT_VALUES);

  applyUiScheme(settings.uiScheme);
  bindSettingsControls();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;
  } catch (_) {}

  await refreshActiveTabContext();
  renderExplorer();

  // Bind quick filter & segment tabs
  const filterInput = document.getElementById('quickFilterInput');
  filterInput.addEventListener('input', renderExplorer);

  document.querySelectorAll('.segment-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.segment-btn').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      activeFilter = btn.dataset.filter || 'all';
      renderExplorer();
    });
  });

  // Primary Action Button & Sign Out Button
  document.getElementById('signOutBtn').addEventListener('click', async () => {
    if (!activeTab?.id || !activePageContext?.ok) return;
    try {
      await chrome.tabs.sendMessage(activeTab.id, { type: 'PERFORM_SIGN_OUT' });
    } catch (_) {
      if (activePageContext.logoutUrl) {
        chrome.tabs.update(activeTab.id, { url: activePageContext.logoutUrl });
      }
    }
    window.close();
  });

  document.getElementById('primaryActionBtn').addEventListener('click', async () => {
    const downloadable = pageMediaItems.find((item) => item.downloadUrl);
    if (downloadable) {
      await triggerDownload(downloadable.downloadUrl, downloadable.filename);
      return;
    }
    if (pageMediaItems[0]?.viewUrl) {
      chrome.tabs.create({ url: pageMediaItems[0].viewUrl });
      return;
    }
    const targetRoot = activePageContext?.wwwroot || activePageContext?.origin || settings.lastMoodleWwwroot || settings.lastMoodleOrigin;
    if (targetRoot) {
      chrome.tabs.create({ url: `${String(targetRoot).replace(/\/+$/, '')}/my/` });
    } else {
      chrome.runtime.openOptionsPage();
    }
  });

  // Side Panel & Options Navigation
  document.getElementById('openSidePanelBtn').addEventListener('click', async () => {
    try {
      if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function' && activeTab?.windowId) {
        await chrome.sidePanel.open({ windowId: activeTab.windowId });
        window.close();
        return;
      }
    } catch (_) {}
    await chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL', windowId: activeTab?.windowId });
    window.close();
  });

  document.getElementById('openOptionsBtn').addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.openOptionsPage === 'function') {
      chrome.runtime.openOptionsPage();
    } else {
      window.open('../options/options.html', '_blank');
    }
  });

  function applyUiScheme(scheme) {
    if (scheme === 'light' || scheme === 'dark') {
      document.documentElement.setAttribute('data-ui-scheme', scheme);
    } else {
      document.documentElement.removeAttribute('data-ui-scheme');
    }
  }

  function isHexColor(str) {
    return /^#[0-9a-fA-F]{6}$/.test(String(str || '').trim());
  }

  function bindSettingsControls() {
    ['autoUnwrap', 'hideCompletion'].forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.checked = Boolean(settings[id]);
      input.addEventListener('change', async () => {
        settings[id] = input.checked;
        await writeStorage({ [id]: input.checked });
      });
    });

    ['uiScheme', 'theme', 'density', 'navStyle', 'courseNavStyle'].forEach((id) => {
      const select = document.getElementById(id);
      if (!select) return;
      const val = settings[id] || DEFAULT_VALUES[id];
      // Ensure fallback if previous theme is legacy (cyberpunk/aurora)
      if ([...select.options].some((opt) => opt.value === val)) {
        select.value = val;
      } else {
        select.value = DEFAULT_VALUES[id];
      }
      select.addEventListener('change', async () => {
        settings[id] = select.value;
        if (id === 'uiScheme') applyUiScheme(select.value);
        await writeStorage({ [id]: select.value });
      });
    });

    const cnavPicker = document.getElementById('courseNavBgPicker');
    const cnavReset = document.getElementById('courseNavBgReset');
    if (cnavPicker) {
      cnavPicker.value = isHexColor(settings.courseNavBg) ? settings.courseNavBg : '#121215';
      cnavPicker.addEventListener('input', async (e) => {
        settings.courseNavBg = e.target.value;
        await writeStorage({ courseNavBg: e.target.value });
      });
    }
    if (cnavReset) {
      cnavReset.addEventListener('click', async () => {
        settings.courseNavBg = '';
        if (cnavPicker) cnavPicker.value = '#121215';
        await writeStorage({ courseNavBg: '' });
      });
    }

    const decBtn = document.getElementById('popupScaleDec');
    const incBtn = document.getElementById('popupScaleInc');
    const valEl = document.getElementById('popupScaleVal');

    const updateScaleUi = (raw) => {
      const clamped = Math.max(85, Math.min(125, Number(raw) || 100));
      settings.uiScale = clamped;
      if (valEl) valEl.textContent = `${clamped}%`;
      if (decBtn) decBtn.disabled = clamped <= 85;
      if (incBtn) incBtn.disabled = clamped >= 125;
      return clamped;
    };

    updateScaleUi(settings.uiScale);

    decBtn?.addEventListener('click', async () => {
      const next = updateScaleUi((Number(settings.uiScale) || 100) - 5);
      await writeStorage({ uiScale: next });
    });

    incBtn?.addEventListener('click', async () => {
      const next = updateScaleUi((Number(settings.uiScale) || 100) + 5);
      await writeStorage({ uiScale: next });
    });
  }

  async function refreshActiveTabContext() {
    const statusDot = document.getElementById('moodleStatusDot');
    const hostText = document.getElementById('activeHostText');
    const primaryBtn = document.getElementById('primaryActionBtn');
    const primaryLabel = document.getElementById('primaryActionLabel');
    const signOutBtn = document.getElementById('signOutBtn');

    activePageContext = null;
    pageMediaItems = [];

    const urlStr = activeTab?.url || '';
    const isHttp = /^https?:\/\//i.test(urlStr);

    if (isHttp && activeTab?.id) {
      try {
        const res = await chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PAGE_CONTEXT' });
        if (res && res.ok) {
          activePageContext = res;
          if (Array.isArray(res.media)) {
            pageMediaItems = res.media;
          }
        }
      } catch (_) {}
    }

    if (!hasChromeStorage && !activePageContext) {
      activePageContext = {
        ok: true,
        hostname: 'moodle.example.edu',
        path: '/course/view.php?id=166',
        isLogin: false
      };
      pageMediaItems = [
        { title: '04. előadás — REST API (1080p)', sourceType: 'mp4', canDownload: true, downloadUrl: '#video-dl', viewUrl: '#video', filename: '04_eloadas.mp4' },
        { title: 'Gyakorlati segédanyag.pdf', sourceType: 'resource', canDownload: true, downloadUrl: '#pdf-dl', viewUrl: '#pdf', filename: 'segedanyag.pdf' }
      ];
    }

    if (activePageContext) {
      statusDot.classList.add('active');
      if (signOutBtn) {
        signOutBtn.disabled = Boolean(activePageContext.isLogin);
      }

      const host = activePageContext.hostname || 'Moodle';
      const path = activePageContext.path || '/';
      hostText.textContent = path === '/' ? host : `${host}${path}`;
      hostText.title = urlStr;

      const downloadable = pageMediaItems.find((item) => item.downloadUrl);
      if (downloadable) {
        primaryLabel.textContent = 'Letöltés';
        primaryBtn.title = `Letöltés: ${downloadable.title}`;
      } else if (pageMediaItems.length > 0) {
        primaryLabel.textContent = 'Megnyitás';
        primaryBtn.title = `Megnyitás: ${pageMediaItems[0].title}`;
      } else {
        primaryLabel.textContent = 'Irányítópult';
        primaryBtn.title = 'Moodle Irányítópult megnyitása';
      }
    } else {
      statusDot.classList.remove('active');
      if (signOutBtn) signOutBtn.disabled = true;

      const savedHost = (() => {
        try { return settings.lastMoodleOrigin ? new URL(settings.lastMoodleOrigin).hostname : ''; } catch (_) { return ''; }
      })();
      hostText.textContent = savedHost ? `Inaktív (${savedHost})` : 'Nincs aktív Moodle lap';
      hostText.title = settings.lastMoodleOrigin
        ? `Legutóbbi Moodle: ${settings.lastMoodleOrigin}`
        : 'Nyisd meg az iskolád Moodle oldalát';
      primaryLabel.textContent = settings.lastMoodleOrigin ? 'Moodle' : 'Beállítás';
      primaryBtn.title = settings.lastMoodleOrigin
        ? `Irányítópult megnyitása: ${settings.lastMoodleOrigin}`
        : 'BetterMoodle beállítások megnyitása';
    }
  }

  function renderExplorer() {
    const listEl = document.getElementById('explorerList');
    const countEl = document.getElementById('explorerCount');
    const query = (document.getElementById('quickFilterInput').value || '').toLowerCase().trim();
    const pinnedSet = new Set(settings.pinnedCourses || []);

    const courses = [...(settings.cachedCourses || [])].sort((a, b) => {
      const ap = pinnedSet.has(a.id) ? 0 : 1;
      const bp = pinnedSet.has(b.id) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return String(a.title || '').localeCompare(String(b.title || ''), 'hu');
    });

    const combined = [];
    if (activeFilter === 'all' || activeFilter === 'media') {
      pageMediaItems.forEach((m) => combined.push({ kind: 'media', ...m }));
    }
    if (activeFilter === 'all' || activeFilter === 'courses') {
      courses.forEach((c) => combined.push({ kind: 'course', ...c }));
    }

    const filtered = combined.filter((item) => {
      if (!query) return true;
      const hay = `${item.title || ''} ${item.category || ''} ${item.sourceType || ''}`.toLowerCase();
      return hay.includes(query);
    });

    countEl.textContent = String(filtered.length);
    listEl.innerHTML = '';

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'explorer-empty';
      empty.textContent = activeFilter === 'media'
        ? 'Nincs észlelt videó vagy fájl ezen az oldalon.'
        : 'Nincs megjeleníthető elem.';
      listEl.appendChild(empty);
      return;
    }

    filtered.slice(0, 40).forEach((item) => {
      const row = document.createElement('div');
      row.className = 'explorer-row';
      row.setAttribute('role', 'listitem');

      const main = document.createElement('div');
      main.className = 'row-main';

      const iconWrap = document.createElement('span');
      iconWrap.className = `row-icon ${item.kind === 'media' ? 'is-media' : ''}`;
      iconWrap.setAttribute('aria-hidden', 'true');
      iconWrap.innerHTML = item.kind === 'media' ? getVideoSvg() : getBookSvg();

      const textCol = document.createElement('div');
      textCol.className = 'row-text';

      const titleEl = document.createElement('span');
      titleEl.className = 'row-title';
      titleEl.textContent = item.title || 'Névtelen elem';
      titleEl.title = item.title || 'Névtelen elem';

      const metaEl = document.createElement('span');
      metaEl.className = 'row-meta tabular';
      metaEl.textContent = item.kind === 'media'
        ? `${String(item.sourceType || 'Média').toUpperCase()}${item.canDownload ? ' • Letölthető' : ' • Külső'}`
        : `${item.category || 'Kurzus'}${item.hasprogress && item.progress !== null ? ` • ${item.progress}%` : ''}`;
      metaEl.title = metaEl.textContent;

      textCol.appendChild(titleEl);
      textCol.appendChild(metaEl);
      main.appendChild(iconWrap);
      main.appendChild(textCol);

      const actions = document.createElement('div');
      actions.className = 'row-actions';

      if (item.kind === 'media' && item.downloadUrl) {
        const dlBtn = document.createElement('button');
        dlBtn.type = 'button';
        dlBtn.className = 'btn-icon';
        dlBtn.title = `Letöltés: ${item.title}`;
        dlBtn.setAttribute('aria-label', `Letöltés: ${item.title}`);
        dlBtn.innerHTML = getDownloadSvg();
        dlBtn.addEventListener('click', () => triggerDownload(item.downloadUrl, item.filename));
        actions.appendChild(dlBtn);
      }

      const openUrl = item.viewUrl || item.url;
      if (openUrl) {
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'btn-icon';
        openBtn.title = `Megnyitás: ${item.title}`;
        openBtn.setAttribute('aria-label', `Megnyitás: ${item.title}`);
        openBtn.innerHTML = getExternalSvg();
        openBtn.addEventListener('click', () => {
          if (item.kind === 'course' && activeTab?.id && activePageContext?.ok && activePageContext.origin && openUrl.startsWith(activePageContext.origin)) {
            chrome.tabs.update(activeTab.id, { url: openUrl });
            window.close();
          } else {
            chrome.tabs.create({ url: openUrl });
          }
        });
        actions.appendChild(openBtn);
      }

      row.appendChild(main);
      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  async function triggerDownload(url, filename) {
    try {
      await chrome.runtime.sendMessage({ type: 'DOWNLOAD_FILE', url, filename });
    } catch (_) {
      chrome.downloads.download({ url, filename: filename || undefined });
    }
  }

  function getVideoSvg() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>';
  }

  function getBookSvg() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>';
  }

  function getDownloadSvg() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>';
  }

  function getExternalSvg() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>';
  }
});
