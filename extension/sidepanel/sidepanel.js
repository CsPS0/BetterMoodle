// ==========================================================================
// BetterMoodle - Side Panel Script
// ==========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  const DEFAULT_VALUES = {
    uiScheme: 'auto',
    cachedCourses: [],
    cachedDeadlines: [],
    pinnedCourses: [],
    lastMoodleOrigin: ''
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
    const nowSec = Math.floor(Date.now() / 1000);
    return {
      ...defaults,
      uiScheme: 'dark',
      lastMoodleOrigin: 'https://moodle.example.edu',
      pinnedCourses: ['166'],
      cachedCourses: [
        { id: '166', title: 'Szoftverfejlesztési gyakorlatok', category: 'Informatika', url: '#course-166', hasprogress: true, progress: 78 },
        { id: '142', title: 'Adatbázis-kezelő rendszerek', category: 'Adatbázisok', url: '#course-142', hasprogress: true, progress: 62 },
        { id: '188', title: 'Számítógép-hálózatok II.', category: 'Hálózatok', url: '#course-188', hasprogress: true, progress: 45 }
      ],
      cachedDeadlines: [
        { id: 'd1', name: 'REST API beadandó', courseName: 'Szoftverfejlesztési gyakorlatok', url: '#d1', actionUrl: '#d1', timesort: nowSec + 18 * 3600 },
        { id: 'd2', name: 'SQL optimalizálás ZH', courseName: 'Adatbázis-kezelő rendszerek', url: '#d2', actionUrl: '#d2', timesort: nowSec + 72 * 3600 }
      ]
    };
  }

  let state = await readStorage(DEFAULT_VALUES);
  let activeTab = null;
  let pageContext = null;
  let pageMedia = [];

  applyUiScheme(state.uiScheme);

  document.getElementById('spSignOutBtn').addEventListener('click', async () => {
    if (!activeTab?.id || !pageContext?.ok) return;
    try {
      await chrome.tabs.sendMessage(activeTab.id, { type: 'PERFORM_SIGN_OUT' });
    } catch (_) {
      if (pageContext.logoutUrl) {
        chrome.tabs.update(activeTab.id, { url: pageContext.logoutUrl });
      }
    }
  });

  document.getElementById('spOptionsBtn').addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.openOptionsPage === 'function') {
      chrome.runtime.openOptionsPage();
    } else {
      window.open('../options/options.html', '_blank');
    }
  });

  document.getElementById('spRescanBtn').addEventListener('click', () => {
    scanActiveTab();
  });

  document.getElementById('spCourseSearch').addEventListener('input', renderCourses);

  if (hasChromeStorage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      let shouldRenderCourses = false;
      let shouldRenderDeadlines = false;
      for (const [k, ch] of Object.entries(changes)) {
        state[k] = ch.newValue;
        if (k === 'uiScheme') applyUiScheme(ch.newValue);
        if (k === 'cachedCourses' || k === 'pinnedCourses') shouldRenderCourses = true;
        if (k === 'cachedDeadlines') shouldRenderDeadlines = true;
      }
      if (shouldRenderCourses) renderCourses();
      if (shouldRenderDeadlines) renderDeadlines();
    });
  }

  if (typeof chrome !== 'undefined' && chrome.tabs) {
    chrome.tabs.onActivated?.addListener(() => {
      scanActiveTab();
    });

    chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
      if (activeTab && tabId === activeTab.id && changeInfo.status === 'complete') {
        scanActiveTab();
      }
    });
  }

  await scanActiveTab();
  renderCourses();
  renderDeadlines();

  function applyUiScheme(scheme) {
    if (scheme === 'light' || scheme === 'dark') {
      document.documentElement.setAttribute('data-ui-scheme', scheme);
    } else {
      document.documentElement.removeAttribute('data-ui-scheme');
    }
  }

  async function scanActiveTab() {
    const dot = document.getElementById('spStatusDot');
    const hostText = document.getElementById('spHostText');
    const signOutBtn = document.getElementById('spSignOutBtn');

    pageContext = null;
    pageMedia = [];

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = tab || null;
    } catch (_) {
      activeTab = null;
    }

    const urlStr = activeTab?.url || '';
    const isHttp = /^https?:\/\//i.test(urlStr);

    if (isHttp && activeTab?.id) {
      try {
        const res = await chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PAGE_CONTEXT' });
        if (res && res.ok) {
          pageContext = res;
          if (Array.isArray(res.media)) {
            pageMedia = res.media;
          }
        }
      } catch (_) {}
    }

    if (!hasChromeStorage && !pageContext) {
      pageContext = {
        ok: true,
        hostname: 'moodle.example.edu',
        path: '/course/view.php?id=166',
        isLogin: false
      };
      pageMedia = [
        { title: '04. előadás — REST API (1080p)', sourceType: 'mp4', canDownload: true, downloadUrl: '#video-dl', viewUrl: '#video', filename: '04_eloadas.mp4' },
        { title: 'Gyakorlati segédanyag.pdf', sourceType: 'resource', canDownload: true, downloadUrl: '#pdf-dl', viewUrl: '#pdf', filename: 'segedanyag.pdf' }
      ];
    }

    if (pageContext) {
      dot.classList.add('active');
      if (signOutBtn) {
        signOutBtn.disabled = Boolean(pageContext.isLogin);
      }
      const host = pageContext.hostname || 'Moodle';
      const path = pageContext.path || '/';
      hostText.textContent = path === '/' ? host : `${host}${path}`;
      hostText.title = urlStr;
    } else {
      dot.classList.remove('active');
      if (signOutBtn) signOutBtn.disabled = true;
      const savedHost = (() => {
        try { return state.lastMoodleOrigin ? new URL(state.lastMoodleOrigin).hostname : ''; } catch (_) { return ''; }
      })();
      hostText.textContent = savedHost ? `Inaktív (${savedHost})` : 'Nem Moodle oldal';
      hostText.title = urlStr || 'Nyiss meg egy Moodle oldalt';
    }

    renderMedia();
  }

  function renderMedia() {
    const listEl = document.getElementById('spMediaList');
    const countEl = document.getElementById('spMediaCount');
    countEl.textContent = String(pageMedia.length);
    listEl.innerHTML = '';

    if (pageMedia.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Nyiss meg egy videót vagy kurzust a média letöltéséhez.';
      listEl.appendChild(empty);
      return;
    }

    pageMedia.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.setAttribute('role', 'listitem');

      const main = document.createElement('div');
      main.className = 'row-main';

      const title = document.createElement('span');
      title.className = 'row-title-text';
      title.textContent = item.title || 'Médiafájl';
      title.title = item.title || 'Médiafájl';

      const meta = document.createElement('span');
      meta.className = 'row-meta tabular';
      meta.textContent = `${String(item.sourceType || 'Média').toUpperCase()}${item.canDownload ? ' • Letölthető' : ' • Külső'}`;
      meta.title = meta.textContent;

      main.appendChild(title);
      main.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'row-actions';

      if (item.downloadUrl) {
        const dlBtn = document.createElement('button');
        dlBtn.type = 'button';
        dlBtn.className = 'btn-icon';
        dlBtn.title = `Letöltés: ${item.title}`;
        dlBtn.setAttribute('aria-label', `Letöltés: ${item.title}`);
        dlBtn.innerHTML = getDownloadSvg();
        dlBtn.addEventListener('click', () => triggerDownload(item.downloadUrl, item.filename));
        actions.appendChild(dlBtn);
      }

      if (item.viewUrl) {
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'btn-icon';
        openBtn.title = `Megnyitás: ${item.title}`;
        openBtn.setAttribute('aria-label', `Megnyitás: ${item.title}`);
        openBtn.innerHTML = getExternalSvg();
        openBtn.addEventListener('click', () => chrome.tabs.create({ url: item.viewUrl }));
        actions.appendChild(openBtn);
      }

      row.appendChild(main);
      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  function renderCourses() {
    const listEl = document.getElementById('spCourseList');
    const countEl = document.getElementById('spCourseCount');
    const q = (document.getElementById('spCourseSearch').value || '').toLowerCase().trim();
    const pinnedSet = new Set(state.pinnedCourses || []);

    const courses = [...(state.cachedCourses || [])]
      .sort((a, b) => {
        const ap = pinnedSet.has(a.id) ? 0 : 1;
        const bp = pinnedSet.has(b.id) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return String(a.title || '').localeCompare(String(b.title || ''), 'hu');
      })
      .filter((c) => !q || String(c.title || '').toLowerCase().includes(q) || String(c.category || '').toLowerCase().includes(q));

    countEl.textContent = String(courses.length);
    listEl.innerHTML = '';

    if (courses.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Nincs találat vagy még nincs betöltött kurzus.';
      listEl.appendChild(empty);
      return;
    }

    courses.forEach((course) => {
      const isPinned = pinnedSet.has(course.id);
      const row = document.createElement('div');
      row.className = 'list-row';
      row.setAttribute('role', 'listitem');

      const main = document.createElement('div');
      main.className = 'row-main';

      const link = document.createElement('a');
      link.className = 'row-title-link';
      link.href = course.url;
      link.textContent = course.title;
      link.title = course.title;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (activeTab?.id && pageContext?.ok && pageContext.origin && course.url.startsWith(pageContext.origin)) {
          chrome.tabs.update(activeTab.id, { url: course.url });
        } else {
          chrome.tabs.create({ url: course.url });
        }
      });

      const meta = document.createElement('span');
      meta.className = 'row-meta tabular';
      meta.textContent = `${course.category || 'Kurzus'}${course.hasprogress && course.progress !== null ? ` • ${course.progress}%` : ''}`;
      meta.title = meta.textContent;

      main.appendChild(link);
      main.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'row-actions';

      const pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = `btn-icon ${isPinned ? 'pinned' : ''}`;
      pinBtn.title = isPinned ? 'Kitűzés levétele' : 'Kitűzés felülre';
      pinBtn.setAttribute('aria-label', isPinned ? `Kitűzés levétele: ${course.title}` : `Kitűzés: ${course.title}`);
      pinBtn.innerHTML = getStarSvg(isPinned);
      pinBtn.addEventListener('click', async () => {
        const nextSet = new Set(state.pinnedCourses || []);
        if (nextSet.has(course.id)) nextSet.delete(course.id);
        else nextSet.add(course.id);
        state.pinnedCourses = Array.from(nextSet);
        await chrome.storage.local.set({ pinnedCourses: state.pinnedCourses });
        renderCourses();
      });

      actions.appendChild(pinBtn);
      row.appendChild(main);
      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  function renderDeadlines() {
    const listEl = document.getElementById('spDeadlineList');
    const countEl = document.getElementById('spDeadlineCount');
    const deadlines = state.cachedDeadlines || [];

    countEl.textContent = String(deadlines.length);
    listEl.innerHTML = '';

    if (deadlines.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Nincs közelgő határidős feladat.';
      listEl.appendChild(empty);
      return;
    }

    deadlines.forEach((d) => {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.setAttribute('role', 'listitem');

      const main = document.createElement('div');
      main.className = 'row-main';

      const link = document.createElement('a');
      link.className = 'row-title-link';
      link.href = d.url || d.actionUrl || '#';
      link.textContent = d.name || 'Feladat';
      link.title = d.name || 'Feladat';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = d.actionUrl && d.actionUrl !== '#' ? d.actionUrl : d.url;
        if (target && target !== '#') chrome.tabs.create({ url: target });
      });

      const meta = document.createElement('span');
      meta.className = 'row-meta';
      meta.textContent = d.courseName || 'Határidő';
      meta.title = d.courseName || 'Határidő';

      main.appendChild(link);
      main.appendChild(meta);

      const badge = document.createElement('span');
      let badgeText = 'Esedékes';
      let badgeClass = 'deadline-badge';
      if (d.timesort) {
        const diffHours = Math.round((d.timesort * 1000 - Date.now()) / 3600000);
        if (diffHours <= 0) {
          badgeText = 'Lejárt';
          badgeClass += ' urgent';
        } else if (diffHours < 24) {
          badgeText = `${diffHours}ó`;
          badgeClass += ' urgent';
        } else {
          const days = Math.ceil(diffHours / 24);
          badgeText = `${days} nap`;
          if (days <= 3) badgeClass += ' soon';
        }
      }
      badge.className = badgeClass;
      badge.textContent = badgeText;
      if (d.timesort) {
        badge.title = new Date(d.timesort * 1000).toLocaleString('hu-HU');
      }

      row.appendChild(main);
      row.appendChild(badge);
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

  function getDownloadSvg() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>';
  }

  function getExternalSvg() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>';
  }

  function getStarSvg(filled) {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>`;
  }
});
