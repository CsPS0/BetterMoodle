(() => {
  const STORAGE_KEY = 'color-scheme';
  const metaEl = document.querySelector('meta[name="color-scheme"]');
  const schemeSelect = document.getElementById('schemeSelect');
  const tabButtons = Array.from(document.querySelectorAll('.segment-btn[role="tab"]'));
  const tabPanels = Array.from(document.querySelectorAll('.preview-panel[role="tabpanel"]'));
  const previewCaptionText = document.getElementById('previewCaptionText');
  const previewIndexText = document.getElementById('previewIndexText');

  const CAPTIONS = {
    dashboard: 'Kurzusnézet bal oldalsávval, ikon alapú kurzus navigációval, kereséssel, típusszűrőkkel és helyben letölthető tananyagokkal.',
    popup: '360px-es popup gyors szűrővel és felületméret-léptetővel, mellette az oldalsó panel a médiákhoz, kurzusokhoz és határidőkhöz.',
    cinema: 'Naptáras irányítópult megnyitott Testreszabás panellel: 4 téma, egyéni színek, felületméret és kurzus navigációs sáv beállítások.'
  };

  function getStoredScheme() {
    try {
      const val = localStorage.getItem(STORAGE_KEY);
      return val === 'light' || val === 'dark' ? val : 'light dark';
    } catch (_) {
      return 'light dark';
    }
  }

  function formatSystemLabel() {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return isDark ? 'Rendszer (Sötét)' : 'Rendszer (Világos)';
  }

  // Preview screenshots follow the page's colour mode: "Rendszer" lets each
  // <picture> pick by prefers-color-scheme, Világos/Sötét force a variant.
  const themeSources = Array.from(document.querySelectorAll('source[data-theme-source]'));
  function syncPreviewImages(scheme) {
    const media = scheme === 'light' ? 'all' : scheme === 'dark' ? 'not all' : '(prefers-color-scheme: light)';
    themeSources.forEach((source) => {
      source.media = media;
    });
  }

  function syncSchemeUI(scheme) {
    if (metaEl) {
      metaEl.content = scheme;
    }
    syncPreviewImages(scheme);
    if (schemeSelect) {
      const systemOption = schemeSelect.querySelector('option[value="light dark"]');
      if (systemOption) {
        systemOption.textContent = formatSystemLabel();
      }
      schemeSelect.value = scheme;
    }
  }

  if (schemeSelect) {
    syncSchemeUI(getStoredScheme());

    schemeSelect.addEventListener('change', (e) => {
      const value = e.target.value;
      try {
        if (value === 'light' || value === 'dark') {
          localStorage.setItem(STORAGE_KEY, value);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (_) {}
      syncSchemeUI(value === 'light' || value === 'dark' ? value : 'light dark');
    });
  }

  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', () => {
    if (schemeSelect) {
      const systemOption = schemeSelect.querySelector('option[value="light dark"]');
      if (systemOption) {
        systemOption.textContent = formatSystemLabel();
      }
    }
  });

  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      syncSchemeUI(getStoredScheme());
    }
  });

  function activateTab(targetKey) {
    tabButtons.forEach((btn, idx) => {
      const isActive = btn.dataset.target === targetKey;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.tabIndex = isActive ? 0 : -1;
      if (isActive && previewIndexText) {
        previewIndexText.textContent = `${idx + 1} / ${tabButtons.length}`;
      }
    });

    tabPanels.forEach((panel) => {
      const match = panel.id === `panel-${targetKey}`;
      panel.hidden = !match;
    });

    if (previewCaptionText && CAPTIONS[targetKey]) {
      previewCaptionText.textContent = CAPTIONS[targetKey];
    }
  }

  tabButtons.forEach((btn, idx) => {
    btn.addEventListener('click', () => {
      activateTab(btn.dataset.target);
    });

    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const nextBtn = tabButtons[(idx + dir + tabButtons.length) % tabButtons.length];
        activateTab(nextBtn.dataset.target);
        nextBtn.focus();
      }
    });
  });

})();
