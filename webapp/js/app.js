// BetterMoodle web app: views, routing and session handling.
// Every string that comes from Moodle is rendered as text (never innerHTML): course
// names, summaries and descriptions are teacher-authored HTML, and the token lives
// on this origin.
'use strict';

(function () {
  const { normaliseSite } = globalThis.BMSite;
  const { login, createClient, MoodleError } = globalThis.BMApi;

  const SESSION_KEY = 'bm.session';
  const LAST_SITE_KEY = 'bm.lastSite';
  const THEME_KEY = 'bm.theme';
  const THEMES = [
    ['auto', 'Automatikus'],
    ['midnight', 'Midnight Pro'],
    ['oled', 'OLED Black'],
    ['catppuccin', 'Catppuccin'],
    ['light', 'Clean Light']
  ];

  // ---------------------------------------------------------------- storage
  const store = {
    get(key) {
      try {
        return JSON.parse(localStorage.getItem(key));
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Storage blocked (private mode): the session lasts until the tab closes.
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Nothing stored.
      }
    }
  };

  let session = store.get(SESSION_KEY);
  if (!session || !session.site || !session.token) session = null;
  let client = session ? createClient(session.site, session.token) : null;
  let memo = new Map(); // in-memory only, dropped on sign-out
  let renderTicket = 0;

  // ---------------------------------------------------------------- DOM helpers
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
    add(el, kids);
    return el;
  }
  function fill(el, ...kids) {
    el.replaceChildren();
    return add(el, kids);
  }
  function add(el, kids) {
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    back: ['M15 18l-6-6 6-6'],
    chevron: ['M9 6l6 6-6 6'],
    logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
    theme: ['M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z'],
    refresh: ['M21 12a9 9 0 1 1-2.64-6.36', 'M21 3v6h-6'],
    file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'],
    page: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6', 'M9 17h6'],
    folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
    link: ['M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1', 'M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1'],
    assign: ['M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2', 'M9 3h6v4H9z', 'M9 14l2 2 4-4'],
    quiz: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3', 'M12 17h.01'],
    forum: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
    label: ['M4 6h16', 'M4 12h16', 'M4 18h10'],
    video: ['M3 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M17 10l4-2v8l-4-2'],
    box: ['M21 8l-9-5-9 5v8l9 5 9-5z', 'M3 8l9 5 9-5', 'M12 13v8'],
    download: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 21h14'],
    upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M5 21h14'],
    install: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'],
    clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
    alert: ['M12 3l9.5 17h-19z', 'M12 10v4', 'M12 17h.01'],
    check: ['M5 12l5 5L20 7'],
    x: ['M6 6l12 12', 'M18 6L6 18'],
    plus: ['M12 5v14', 'M5 12h14'],
    external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
    book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z', 'M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5'],
    calendar: ['M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M4 10h16', 'M8 2v4', 'M16 2v4'],
    search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4']
  };
  function icon(name, cls = 'icon') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const d of ICONS[name] || ICONS.box) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }

  const MOD_ICONS = {
    resource: 'file', folder: 'folder', url: 'link', assign: 'assign', quiz: 'quiz', forum: 'forum',
    page: 'page', book: 'book', label: 'label', supervideo: 'video', h5pactivity: 'video', lesson: 'book'
  };

  // Moodle HTML -> plain text with paragraph breaks kept.
  const parser = new DOMParser();
  function toText(html) {
    if (!html) return '';
    const doc = parser.parseFromString(String(html), 'text/html');
    doc.querySelectorAll('script, style').forEach((n) => n.remove());
    doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
    doc.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, tr').forEach((n) => n.append('\n'));
    return (doc.body.textContent || '').replace(/[ \t ]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  }

  // Only http(s) links are ever put into an href.
  function safeHref(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
    } catch {
      return null;
    }
  }

  const dateFmt = new Intl.DateTimeFormat('hu-HU', { month: 'short', day: 'numeric', weekday: 'short' });
  const timeFmt = new Intl.DateTimeFormat('hu-HU', { hour: '2-digit', minute: '2-digit' });
  const fullFmt = new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  function dayLabel(ts) {
    const d = new Date(ts * 1000);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / 86400000);
    if (diff === 0) return 'Ma';
    if (diff === 1) return 'Holnap';
    if (diff === -1) return 'Tegnap';
    return dateFmt.format(d);
  }

  function remaining(ts) {
    const secs = ts - Math.floor(Date.now() / 1000);
    const abs = Math.abs(secs);
    const days = Math.floor(abs / 86400);
    const hours = Math.floor((abs % 86400) / 3600);
    const mins = Math.floor((abs % 3600) / 60);
    const span = days ? `${days} nap ${hours} óra` : hours ? `${hours} óra ${mins} perc` : `${mins} perc`;
    return secs >= 0 ? `${span} van hátra` : `${span} késésben`;
  }

  function fileSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(1)} GB`;
  }

  // ---------------------------------------------------------------- shell
  const view = document.getElementById('view');
  const titleEl = document.getElementById('bar-title');
  const backBtn = document.getElementById('bar-back');
  const actions = document.getElementById('bar-actions');
  const statusEl = document.getElementById('status');
  let installEvent = null;

  function setBar({ title, back }) {
    titleEl.textContent = title || 'BetterMoodle';
    titleEl.title = title || 'BetterMoodle';
    backBtn.hidden = !back;
    backBtn.onclick = back ? () => (location.hash = back) : null;
    document.title = title ? `${title} | BetterMoodle` : 'BetterMoodle';
    renderActions();
  }

  function renderActions() {
    fill(actions, 
      !isStandalone()
        ? h('button', { class: 'icon-btn', type: 'button', title: 'Telepítés', 'aria-label': 'Alkalmazás telepítése', onclick: () => (installEvent ? install() : openInstallDialog()) }, icon('install'))
        : null,
      h('button', { class: 'icon-btn', type: 'button', title: 'Megjelenés', 'aria-label': 'Megjelenés', onclick: openThemeDialog }, icon('theme')),
      session
        ? h('button', { class: 'icon-btn', type: 'button', title: 'Kijelentkezés', 'aria-label': 'Kijelentkezés', onclick: confirmSignOut }, icon('logout'))
        : null
    );
  }

  let statusTimer = 0;
  function announce(text, kind = 'info') {
    clearTimeout(statusTimer);
    statusEl.textContent = text;
    statusEl.dataset.kind = kind;
    statusEl.hidden = !text;
    if (text) statusTimer = setTimeout(() => (statusEl.hidden = true), 5000);
  }

  function loading(text = 'Betöltés…') {
    fill(view, h('div', { class: 'state', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text));
  }

  function errorState(err, retry) {
    fill(view, 
      h('div', { class: 'state state-error', role: 'alert' },
        icon('alert', 'icon icon-lg'),
        h('p', null, err.message || 'Hiba történt.'),
        retry ? h('button', { class: 'btn', type: 'button', onclick: retry }, icon('refresh'), 'Újra') : null)
    );
  }

  // Runs a view; an invalid token sends the user back to login with a message.
  async function guard(ticket, fn, retry) {
    try {
      await fn();
    } catch (err) {
      if (ticket !== renderTicket) return;
      if (err instanceof MoodleError && err.auth) {
        signOut(err.message);
        return;
      }
      console.error(err);
      errorState(err, retry);
    }
  }

  function cached(key, loader) {
    if (!memo.has(key)) {
      const p = loader().catch((err) => {
        memo.delete(key);
        throw err;
      });
      memo.set(key, p);
    }
    return memo.get(key);
  }

  // ---------------------------------------------------------------- dialogs
  const dialog = document.getElementById('dialog');
  function openDialog(title, body, buttons) {
    return new Promise((resolve) => {
      const form = h('form', { method: 'dialog', class: 'dialog-body' },
        h('h2', null, title),
        body,
        h('div', { class: 'dialog-actions' }, buttons.map(([value, label, cls]) =>
          h('button', { class: `btn ${cls || ''}`, value, type: 'submit' }, label))));
      fill(dialog, form);
      dialog.onclose = () => resolve(dialog.returnValue || 'cancel');
      dialog.returnValue = '';
      dialog.showModal();
    });
  }

  async function confirmSignOut() {
    const answer = await openDialog('Kijelentkezés',
      h('p', null, 'A bejelentkezési token törlődik erről az eszközről. Legközelebb újra meg kell adnod a jelszavad.'),
      [['cancel', 'Mégse'], ['ok', 'Kijelentkezés', 'btn-danger']]);
    if (answer === 'ok') signOut();
  }

  function signOut(message) {
    session = null;
    client = null;
    memo = new Map();
    store.remove(SESSION_KEY);
    if (location.hash && location.hash !== '#/') history.replaceState(null, '', location.pathname + location.search);
    showLogin(message);
  }

  function applyTheme(theme) {
    if (theme && theme !== 'auto') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas').trim();
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg || '#09090b'));
  }

  async function openThemeDialog() {
    const current = store.get(THEME_KEY) || 'auto';
    const list = h('div', { class: 'theme-list', role: 'radiogroup', 'aria-label': 'Téma' },
      THEMES.map(([value, label]) =>
        h('label', { class: 'theme-option' },
          h('input', { type: 'radio', name: 'theme', value, checked: value === current, onchange: () => {
            store.set(THEME_KEY, value);
            applyTheme(value);
          } }),
          h('span', { class: `swatch swatch-${value}`, 'aria-hidden': 'true' }),
          label)));
    await openDialog('Megjelenés', list, [['ok', 'Kész', 'btn-primary']]);
  }

  async function install() {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => null);
    installEvent = null;
    renderActions();
  }

  // ---------------------------------------------------------------- install help
  // A web app cannot be downloaded like an APK: the browser installs it from this page.
  // Chrome / Edge (Android and desktop) offer a one-tap prompt (beforeinstallprompt);
  // Safari on iPhone and other browsers need the manual steps below.
  function isStandalone() {
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function platform() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
  }

  const INSTALL_STEPS = {
    android: [
      'Nyisd meg a Chrome menüjét (⋮) a jobb felső sarokban.',
      'Válaszd az „Alkalmazás telepítése” vagy a „Hozzáadás a kezdőképernyőhöz” lehetőséget.',
      'Erősítsd meg a Telepítés gombbal. Az ikon megjelenik a kezdőképernyőn.'
    ],
    ios: [
      'Nyisd meg ezt az oldalt Safariban.',
      'Koppints a Megosztás gombra (négyzet felfelé mutató nyíllal).',
      'Válaszd a „Főképernyőhöz adás” lehetőséget, majd a Hozzáadás gombot.'
    ],
    desktop: [
      'Chrome-ban vagy Edge-ben kattints a címsor jobb szélén a telepítés ikonra.',
      'Vagy a böngésző menüjében válaszd az „Alkalmazás telepítése” lehetőséget.'
    ]
  };

  async function openInstallDialog() {
    if (isStandalone()) {
      await openDialog('Telepítés', h('p', null, 'A BetterMoodle már telepítve van, és alkalmazásként fut.'), [['ok', 'Rendben', 'btn-primary']]);
      return;
    }
    const lead = h('p', null, 'Telepítve a BetterMoodle saját ikonnal, külön ablakban indul, mint egy telefonos alkalmazás. Nem kell semmit letölteni.');
    if (installEvent) {
      const answer = await openDialog('Telepítés', lead, [['cancel', 'Később'], ['install', 'Telepítés', 'btn-primary']]);
      if (answer === 'install') install();
      return;
    }
    const steps = h('ol', { class: 'steps' }, INSTALL_STEPS[platform()].map((s) => h('li', null, s)));
    await openDialog('Telepítés', h('div', { class: 'dialog-stack' }, lead, steps), [['ok', 'Rendben', 'btn-primary']]);
  }

  // Chrome fires beforeinstallprompt shortly after load; give it a moment before falling back to steps.
  function waitForInstallEvent(ms) {
    if (installEvent || isStandalone()) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        window.removeEventListener('beforeinstallprompt', done);
        resolve();
      };
      window.addEventListener('beforeinstallprompt', done);
      setTimeout(done, ms);
    });
  }

  // ---------------------------------------------------------------- login
  function showLogin(message) {
    renderTicket++;
    setBar({ title: 'Bejelentkezés' });
    const lastSite = store.get(LAST_SITE_KEY) || '';
    const err = h('p', { class: 'form-error', role: 'alert', hidden: !message }, message || '');
    const siteInput = h('input', { id: 'site', name: 'site', type: 'text', inputmode: 'url', autocomplete: 'url', autocapitalize: 'off', spellcheck: 'false', placeholder: 'https://moodle.iskola.hu', required: true, value: lastSite });
    const userInput = h('input', { id: 'username', name: 'username', type: 'text', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true });
    const passInput = h('input', { id: 'password', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
    const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Bejelentkezés');

    async function onSubmit(event) {
      event.preventDefault();
      err.hidden = true;
      const site = normaliseSite(siteInput.value);
      if (!site) {
        err.textContent = 'Érvénytelen cím. Írd be a teljes HTTPS-címet, például https://moodle.iskola.hu';
        err.hidden = false;
        siteInput.focus();
        return;
      }
      siteInput.value = site;
      submit.disabled = true;
      submit.textContent = 'Bejelentkezés…';
      try {
        const token = await login(site, userInput.value.trim(), passInput.value);
        passInput.value = '';
        const c = createClient(site, token);
        const info = await c.call('core_webservice_get_site_info');
        session = {
          site,
          token,
          userid: info.userid,
          sitename: toText(info.sitename),
          fullname: toText(info.fullname),
          firstname: toText(info.firstname),
          version: String(info.version || ''),
          release: String(info.release || ''),
          uploadfiles: info.uploadfiles !== 0 && info.uploadfiles !== false,
          downloadfiles: info.downloadfiles !== 0 && info.downloadfiles !== false,
          functions: Array.isArray(info.functions) ? info.functions.map((f) => f.name) : null
        };
        client = c;
        memo = new Map();
        store.set(SESSION_KEY, session);
        store.set(LAST_SITE_KEY, site);
        location.hash = '#/';
        route();
      } catch (e) {
        let text = e.message || 'A bejelentkezés nem sikerült.';
        if (e.errorcode === 'http404' || e.errorcode === 'invalidresponse') {
          text = 'Ezen a címen nem található Moodle, vagy nem érhető el a mobilos bejelentkezés. Ellenőrizd a címet.';
        }
        err.textContent = text;
        err.hidden = false;
        submit.disabled = false;
        submit.textContent = 'Bejelentkezés';
      }
    }

    fill(view, 
      h('section', { class: 'login' },
        h('img', { class: 'login-logo', src: 'icons/logo.svg', alt: '', width: 56, height: 56 }),
        h('h1', null, 'BetterMoodle'),
        h('p', { class: 'muted' }, 'Jelentkezz be a saját iskolád Moodle-oldalára.'),
        h('form', { class: 'card form', onsubmit: onSubmit, novalidate: true },
          h('label', { for: 'site' }, 'Moodle címe'), siteInput,
          h('label', { for: 'username' }, 'Felhasználónév'), userInput,
          h('label', { for: 'password' }, 'Jelszó'), passInput,
          err,
          submit),
        h('p', { class: 'fine' },
          'A jelszavad csak a Moodle-oldalhoz kerül; az alkalmazás csak a kapott tokent tárolja ezen az eszközön. ',
          'Ha az iskolád csak külső (például Microsoft vagy Google) bejelentkezést használ, ez a mód nem működik.'))
    );
    (lastSite ? userInput : siteInput).focus();
  }

  // ---------------------------------------------------------------- data
  const hasFn = (name) => !session.functions || session.functions.includes(name);
  const versionAtLeast = (v) => Number(session.version || 0) >= v;

  function getCourses(force) {
    if (force) memo.delete('courses');
    return cached('courses', () =>
      client.call('core_enrol_get_users_courses', versionAtLeast(2021051700)
        ? { userid: session.userid, returnusercount: false }
        : { userid: session.userid }));
  }

  function getEvents(force) {
    if (force) memo.delete('events');
    const from = Math.floor(Date.now() / 1000) - 14 * 86400;
    return cached('events', () =>
      client.call('core_calendar_get_action_events_by_timesort', { timesortfrom: from, limitnum: 50 }));
  }

  // ---------------------------------------------------------------- dashboard
  function showDashboard(force = false) {
    const ticket = ++renderTicket;
    setBar({ title: session.sitename || 'BetterMoodle' });
    loading();
    guard(ticket, async () => {
      const wantEvents = hasFn('core_calendar_get_action_events_by_timesort');
      const [events, courses] = await Promise.all([
        wantEvents ? getEvents(force) : Promise.resolve(null),
        getCourses(force)
      ]);
      if (ticket !== renderTicket) return;
      const now = Math.floor(Date.now() / 1000);
      const list = Array.isArray(courses) ? courses.slice() : [];
      list.sort((a, b) => (b.isfavourite ? 1 : 0) - (a.isfavourite ? 1 : 0) || (b.lastaccess || 0) - (a.lastaccess || 0));
      const past = (c) => c.enddate && c.enddate < now;
      const current = list.filter((c) => !past(c));
      const old = list.filter(past);

      const courseRow = (c) =>
        h('a', { class: 'row', href: `#/course/${c.id}` },
          h('span', { class: 'row-icon' }, icon('book')),
          h('span', { class: 'row-main' },
            h('span', { class: 'row-title', title: toText(c.fullname) }, toText(c.fullname)),
            h('span', { class: 'row-meta' },
              toText(c.shortname),
              typeof c.progress === 'number' ? h('span', { class: 'num' }, ` · ${Math.round(c.progress)}%`) : null)),
          typeof c.progress === 'number'
            ? h('span', { class: 'progress', 'aria-label': `Haladás: ${Math.round(c.progress)}%` }, h('span', { class: 'progress-bar', style: null, 'data-p': Math.round(c.progress) }))
            : null,
          icon('chevron', 'icon icon-dim'));

      const search = h('input', { class: 'search', type: 'search', placeholder: 'Kurzus keresése', 'aria-label': 'Kurzus keresése', autocomplete: 'off' });
      const courseList = h('div', { class: 'list' }, current.map(courseRow));
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        // An empty query shows the current courses again; a search also finds past ones.
        const shown = q ? list.filter((c) => `${toText(c.fullname)} ${toText(c.shortname)}`.toLowerCase().includes(q)) : current;
        fill(courseList, ...shown.map(courseRow));
      });

      fill(view, 
        h('section', { class: 'hello' },
          h('h1', null, session.firstname ? `Szia, ${session.firstname}!` : 'Szia!'),
          h('button', { class: 'icon-btn', type: 'button', title: 'Frissítés', 'aria-label': 'Frissítés', onclick: () => showDashboard(true) }, icon('refresh'))),
        wantEvents ? deadlines(events, now) : null,
        h('section', { class: 'block' },
          h('div', { class: 'block-head' }, h('h2', null, 'Kurzusaim'), h('span', { class: 'count num' }, String(current.length))),
          list.length > 6 ? search : null,
          list.length ? courseList : h('p', { class: 'empty' }, 'Nem vagy beiratkozva egy kurzusra sem.'),
          old.length
            ? h('details', { class: 'older' },
              h('summary', null, `Korábbi kurzusok (${old.length})`),
              h('div', { class: 'list' }, old.map(courseRow)))
            : null)
      );
      view.querySelectorAll('.progress-bar').forEach((bar) => bar.style.setProperty('--p', `${bar.dataset.p}%`));
    }, () => showDashboard(true));
  }

  function eventCmid(ev) {
    try {
      return Number(new URL(ev.url).searchParams.get('id')) || null;
    } catch {
      return null;
    }
  }

  function deadlines(data, now) {
    const events = (data && Array.isArray(data.events) ? data.events : []).slice().sort((a, b) => a.timesort - b.timesort);
    const rows = events.map((ev) => {
      const overdue = ev.overdue || ev.timesort < now;
      const cmid = eventCmid(ev);
      const inApp = ev.modulename === 'assign' && cmid && ev.course && ev.course.id;
      const href = inApp ? `#/assign/${ev.course.id}/${cmid}` : safeHref(ev.url);
      const name = toText(ev.activityname || ev.name);
      return h('a', { class: `row deadline${overdue ? ' is-overdue' : ''}`, href, target: inApp ? null : '_blank', rel: inApp ? null : 'noopener' },
        h('span', { class: 'when' },
          h('span', { class: 'when-day' }, dayLabel(ev.timesort)),
          h('span', { class: 'when-time num' }, timeFmt.format(new Date(ev.timesort * 1000)))),
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title', title: name }, name),
          h('span', { class: 'row-meta', title: ev.course ? toText(ev.course.fullname) : '' }, ev.course ? toText(ev.course.fullname) : '')),
        overdue ? h('span', { class: 'badge badge-danger' }, 'Lejárt') : null,
        icon(inApp ? 'chevron' : 'external', 'icon icon-dim'));
    });
    return h('section', { class: 'block' },
      h('div', { class: 'block-head' }, h('h2', null, 'Közelgő határidők'), h('span', { class: 'count num' }, String(events.length))),
      rows.length ? h('div', { class: 'list' }, rows) : h('p', { class: 'empty' }, 'Nincs közelgő határidő.'));
  }

  // ---------------------------------------------------------------- downloads
  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename || 'fajl', hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function downloadButton(file, label) {
    if (!session.downloadfiles) return null;
    const btn = h('button', { class: label ? 'btn' : 'icon-btn', type: 'button', title: `Letöltés: ${file.filename}`, 'aria-label': `Letöltés: ${file.filename}` }, icon('download'));
    btn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (btn.disabled) return;
      btn.disabled = true;
      btn.classList.add('is-busy');
      announce(`Letöltés: ${file.filename}…`);
      try {
        const blob = await client.fetchFile(file.fileurl);
        saveBlob(blob, file.filename);
        announce(`Letöltve: ${file.filename}`, 'success');
      } catch (err) {
        if (err.auth) return signOut(err.message);
        announce(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.classList.remove('is-busy');
      }
    });
    if (label) btn.append(h('span', null, label));
    return btn;
  }

  function fileRow(file) {
    return h('div', { class: 'file' },
      icon('file', 'icon icon-dim'),
      h('span', { class: 'file-name', title: file.filename }, file.filename),
      h('span', { class: 'file-size num' }, fileSize(file.filesize)),
      downloadButton(file));
  }

  // ---------------------------------------------------------------- course
  function showCourse(courseid) {
    const ticket = ++renderTicket;
    setBar({ title: 'Kurzus', back: '#/' });
    loading();
    guard(ticket, async () => {
      const [courses, sections] = await Promise.all([
        getCourses().catch(() => []),
        cached(`course:${courseid}`, () => client.call('core_course_get_contents', { courseid }))
      ]);
      if (ticket !== renderTicket) return;
      const course = (courses || []).find((c) => c.id === courseid);
      const title = course ? toText(course.fullname) : 'Kurzus';
      setBar({ title, back: '#/' });

      const visible = (sections || []).filter((s) => (s.modules && s.modules.length) || toText(s.summary));
      fill(view, 
        h('section', { class: 'course-head' },
          h('h1', { title }, title),
          course && course.shortname ? h('p', { class: 'muted' }, toText(course.shortname)) : null),
        visible.length
          ? visible.map((s, i) => sectionBlock(courseid, s, i < 2))
          : h('p', { class: 'empty' }, 'Ez a kurzus üres.')
      );
    }, () => {
      memo.delete(`course:${courseid}`);
      showCourse(courseid);
    });
  }

  function sectionBlock(courseid, section, open) {
    const mods = (section.modules || []).filter((m) => m.visible !== 0 || m.uservisible);
    const summary = toText(section.summary);
    return h('details', { class: 'section', open },
      h('summary', null,
        h('span', { class: 'section-name', title: toText(section.name) }, toText(section.name) || 'Szakasz'),
        h('span', { class: 'count num' }, String(mods.filter((m) => m.modname !== 'label').length))),
      summary ? h('p', { class: 'section-summary text' }, summary) : null,
      h('div', { class: 'list' }, mods.map((m) => moduleRow(courseid, m))));
  }

  function moduleRow(courseid, m) {
    const name = toText(m.name);
    if (m.modname === 'label') {
      const text = toText(m.description) || name;
      return text ? h('div', { class: 'label-text text' }, text) : null;
    }
    const files = (m.contents || []).filter((c) => c.type === 'file');
    const done = m.completiondata && (m.completiondata.state === 1 || m.completiondata.state === 2);
    const locked = m.uservisible === false;
    const meta = [];
    if (Array.isArray(m.dates)) {
      for (const d of m.dates) meta.push(`${toText(d.label)} ${fullFmt.format(new Date(d.timestamp * 1000))}`);
    }
    if (locked) meta.push('Jelenleg nem elérhető');
    if (m.modname === 'resource' && files[0]) meta.push(fileSize(files[0].filesize));

    const head = [
      h('span', { class: 'row-icon' }, icon(MOD_ICONS[m.modname] || 'box')),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title', title: name }, name),
        meta.length ? h('span', { class: 'row-meta num' }, meta.join(' · ')) : null),
      done ? h('span', { class: 'done', title: 'Teljesítve', 'aria-label': 'Teljesítve' }, icon('check')) : null
    ];

    if (locked) return h('div', { class: 'row is-locked' }, head);

    if (m.modname === 'assign') {
      return h('a', { class: 'row', href: `#/assign/${courseid}/${m.id}` }, head, icon('chevron', 'icon icon-dim'));
    }
    if (m.modname === 'supervideo' && hasFn('mod_supervideo_get_playback_data')) {
      return h('a', { class: 'row', href: `#/video/${courseid}/${m.id}` }, head, icon('chevron', 'icon icon-dim'));
    }
    if (m.modname === 'resource' && files.length === 1 && isVideoFile(files[0]) && session.downloadfiles) {
      return h('a', { class: 'row', href: `#/video/${courseid}/${m.id}` }, head, icon('chevron', 'icon icon-dim'));
    }
    if (m.modname === 'resource' && files.length === 1 && session.downloadfiles) {
      return h('div', { class: 'row' }, head, downloadButton(files[0]));
    }
    if (m.modname === 'folder' && files.length) {
      return h('details', { class: 'folder' },
        h('summary', { class: 'row' }, head, h('span', { class: 'count num' }, String(files.length))),
        h('div', { class: 'files' }, files.map(fileRow)));
    }
    if (m.modname === 'url' && m.contents && m.contents[0]) {
      const href = safeHref(m.contents[0].fileurl);
      if (href) return h('a', { class: 'row', href, target: '_blank', rel: 'noopener' }, head, icon('external', 'icon icon-dim'));
    }
    const href = safeHref(m.url);
    return href
      ? h('a', { class: 'row', href, target: '_blank', rel: 'noopener', title: 'Megnyitás a Moodle weboldalán' }, head, icon('external', 'icon icon-dim'))
      : h('div', { class: 'row' }, head);
  }

  // ---------------------------------------------------------------- video
  // SuperVideo activities: mod_supervideo_get_playback_data (the call the official app uses)
  // returns the source type and a player URL. Drive, YouTube and Vimeo play in their own
  // embedded players; uploaded files play straight from webservice/pluginfile.php.
  // Video files in plain "resource" activities play the same way.
  const EMBED_ORIGINS = {
    // The Drive player briefly frames accounts.google.com to check the Google sign-in (CSP frame-src).
    drive: ['https://drive.google.com'],
    youtube: ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
    vimeo: ['https://player.vimeo.com']
  };
  const MEDIA_EXT = /\.(mp4|m4v|webm|ogv|mov|mp3|m4a|aac|ogg|wav)$/i;

  function isVideoFile(file) {
    return /^(video|audio)\//.test(file.mimetype || '') || MEDIA_EXT.test(file.filename || '');
  }

  function embedUrl(type, url) {
    try {
      const u = new URL(url);
      return (EMBED_ORIGINS[type] || []).includes(u.origin) ? u.toString() : null;
    } catch {
      return null;
    }
  }

  function findModule(sections, cmid) {
    for (const s of sections || []) {
      const m = (s.modules || []).find((x) => x.id === cmid);
      if (m) return m;
    }
    return null;
  }

  function showVideo(courseid, cmid) {
    const ticket = ++renderTicket;
    const back = `#/course/${courseid}`;
    setBar({ title: 'Videó', back });
    loading();
    guard(ticket, async () => {
      const sections = await cached(`course:${courseid}`, () => client.call('core_course_get_contents', { courseid }));
      const m = findModule(sections, cmid);
      if (!m) throw new MoodleError('notfound', 'A videó nem található, vagy nincs hozzá hozzáférésed.');
      let content;
      if (m.modname === 'supervideo') {
        const data = await client.call('mod_supervideo_get_playback_data', { cmid });
        content = data && data.content;
        if (hasFn('mod_supervideo_view_supervideo') && m.instance) {
          client.call('mod_supervideo_view_supervideo', { supervideoid: m.instance }).catch(() => {});
        }
      } else {
        const file = (m.contents || []).find((c) => c.type === 'file');
        if (!file) throw new MoodleError('notfound', 'Ebben az anyagban nincs fájl.');
        content = { type: 'file', fileurl: file.fileurl, filename: file.filename, mimetype: file.mimetype, isaudio: /^audio\//.test(file.mimetype || ''), filesize: file.filesize };
        if (hasFn('mod_resource_view_resource') && m.instance) {
          client.call('mod_resource_view_resource', { resourceid: m.instance }).catch(() => {});
        }
      }
      if (ticket !== renderTicket) return;
      const name = toText(m.name);
      setBar({ title: name, back });
      renderVideo(m, name, content || {});
    }, () => showVideo(courseid, cmid));
  }

  function renderVideo(m, name, c) {
    const type = String(c.type || '');
    const providerId = c.providerid || ((/\/file\/d\/([\w-]+)/.exec(c.fileurl || '') || [])[1]) || '';
    const actions = [];
    let player = null;

    const linkBtn = (href, label, iconName) => (href
      ? h('a', { class: 'btn', href, target: '_blank', rel: 'noopener' }, icon(iconName), label)
      : null);

    if (EMBED_ORIGINS[type]) {
      const src = embedUrl(type, c.fileurl);
      if (src) {
        player = h('iframe', {
          class: 'player-frame', src, title: name,
          allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media',
          // YouTube refuses embeds without a referrer; the page itself sends none.
          referrerpolicy: 'strict-origin-when-cross-origin'
        });
      }
      if (type === 'drive' && providerId) {
        actions.push(linkBtn(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(providerId)}&export=download`, 'Letöltés', 'download'));
        actions.push(linkBtn(`https://drive.google.com/file/d/${encodeURIComponent(providerId)}/view`, 'Megnyitás a Drive-ban', 'external'));
      } else if (type === 'youtube' && providerId) {
        actions.push(linkBtn(`https://www.youtube.com/watch?v=${encodeURIComponent(providerId)}`, 'Megnyitás a YouTube-on', 'external'));
      } else if (type === 'vimeo' && providerId) {
        actions.push(linkBtn(`https://vimeo.com/${encodeURIComponent(providerId)}`, 'Megnyitás a Vimeón', 'external'));
      }
    } else if (type === 'file') {
      const src = client.fileUrl(c.fileurl);
      if (src) {
        player = h(c.isaudio ? 'audio' : 'video', { class: c.isaudio ? 'player-audio' : 'player-video', src, controls: true, playsinline: true, preload: 'metadata' });
        actions.push(downloadButton({ filename: c.filename || 'video', fileurl: c.fileurl, filesize: c.filesize }, 'Letöltés'));
      }
    } else if (type === 'link' && !c.ishls) {
      const src = safeHref(c.fileurl);
      if (src && (c.isaudio || MEDIA_EXT.test(new URL(src).pathname))) {
        player = h(c.isaudio ? 'audio' : 'video', { class: c.isaudio ? 'player-audio' : 'player-video', src, controls: true, playsinline: true, preload: 'metadata' });
      }
      actions.push(linkBtn(src, 'Megnyitás új lapon', 'external'));
    }

    actions.push(linkBtn(safeHref(m.url), 'Megnyitás a Moodle-ben', 'external'));
    fill(view,
      h('section', { class: 'course-head' }, h('h1', { title: name }, name)),
      player
        ? h('div', { class: c.isaudio ? 'player player-is-audio' : 'player' }, player)
        : h('p', { class: 'note' }, 'Ez a videótípus az alkalmazásban nem játszható le. Nyisd meg a Moodle weboldalán.'),
      type === 'drive'
        ? h('p', { class: 'fine' }, 'A Google Drive-videók csak akkor indulnak, ha a böngészőben be vagy jelentkezve egy olyan Google-fiókkal, amely hozzáfér a fájlhoz.')
        : null,
      h('div', { class: 'actions' }, actions));
  }

  // ---------------------------------------------------------------- assignment
  const SUBMISSION_STATUS = {
    new: 'Nincs beadva',
    draft: 'Piszkozat (még nincs beadva értékelésre)',
    submitted: 'Beadva értékelésre',
    reopened: 'Újranyitva',
    marked: 'Értékelve'
  };
  const GRADING_STATUS = {
    graded: 'Értékelve',
    notgraded: 'Nincs értékelve',
    notmarked: 'Nincs értékelve',
    inmarking: 'Értékelés alatt',
    readyforreview: 'Ellenőrzésre kész',
    inreview: 'Ellenőrzés alatt',
    readyforrelease: 'Közzétételre kész',
    released: 'Közzétéve'
  };

  function showAssign(courseid, cmid) {
    const ticket = ++renderTicket;
    const back = `#/course/${courseid}`;
    setBar({ title: 'Feladat', back });
    loading();
    guard(ticket, async () => {
      const res = await cached(`assigns:${courseid}`, () => client.call('mod_assign_get_assignments', { courseids: [courseid] }));
      const course = (res.courses || []).find((c) => c.id === courseid);
      const a = course && (course.assignments || []).find((x) => x.cmid === cmid);
      if (!a) throw new MoodleError('notfound', 'A feladat nem található, vagy nincs hozzá hozzáférésed.');
      const status = await client.call('mod_assign_get_submission_status', { assignid: a.id });
      if (ticket !== renderTicket) return;
      const name = toText(a.name);
      setBar({ title: name, back });
      renderAssign(courseid, cmid, a, status, course);
    }, () => showAssign(courseid, cmid));
  }

  function cfg(a, plugin, subtype, name) {
    const c = (a.configs || []).find((x) => x.plugin === plugin && x.subtype === subtype && x.name === name);
    return c ? c.value : null;
  }

  function pluginFiles(submission, type, area) {
    const p = submission && (submission.plugins || []).find((x) => x.type === type);
    const fa = p && (p.fileareas || []).find((x) => x.area === area);
    return (fa && fa.files) || [];
  }

  function renderAssign(courseid, cmid, a, status, course) {
    const la = status.lastattempt || {};
    const submission = (a.teamsubmission && la.teamsubmission) || la.submission || la.teamsubmission || null;
    const due = la.extensionduedate || a.duedate;
    const now = Math.floor(Date.now() / 1000);
    const fileEnabled = cfg(a, 'file', 'assignsubmission', 'enabled') === '1';
    const textEnabled = cfg(a, 'onlinetext', 'assignsubmission', 'enabled') === '1';
    const existing = pluginFiles(submission, 'file', 'submission_files');
    const textPlugin = submission && (submission.plugins || []).find((p) => p.type === 'onlinetext');
    const existingText = textPlugin && textPlugin.editorfields && textPlugin.editorfields[0] ? textPlugin.editorfields[0].text : '';

    const meta = h('dl', { class: 'facts' },
      fact('Kurzus', toText(course.fullname)),
      a.allowsubmissionsfromdate ? fact('Beadható ettől', fullFmt.format(new Date(a.allowsubmissionsfromdate * 1000))) : null,
      due ? fact('Határidő', fullFmt.format(new Date(due * 1000)), la.extensionduedate ? 'Hosszabbítással' : null) : fact('Határidő', 'Nincs'),
      due && (!submission || submission.status !== 'submitted') ? fact('Hátralévő idő', remaining(due), null, due < now ? 'danger' : due - now < 86400 ? 'warning' : null) : null,
      a.cutoffdate ? fact('Végső határidő', fullFmt.format(new Date(a.cutoffdate * 1000))) : null,
      fact('Beadás állapota', SUBMISSION_STATUS[submission && submission.status] || (submission ? submission.status : SUBMISSION_STATUS.new), null,
        submission && submission.status === 'submitted' ? 'success' : null),
      la.gradingstatus ? fact('Értékelés állapota', GRADING_STATUS[la.gradingstatus] || la.gradingstatus) : null);

    const intro = toText(a.intro);
    const introFiles = [...(a.introattachments || [])];
    const extra = status.assignmentdata && status.assignmentdata.attachments && status.assignmentdata.attachments.intro;
    if (Array.isArray(extra)) for (const f of extra) if (!introFiles.some((x) => x.fileurl === f.fileurl)) introFiles.push(f);

    const feedback = status.feedback;
    const feedbackText = feedback
      ? (feedback.plugins || []).flatMap((p) => (p.editorfields || []).map((e) => toText(e.text))).filter(Boolean).join('\n\n')
      : '';
    const feedbackFiles = feedback ? (feedback.plugins || []).flatMap((p) => (p.fileareas || []).flatMap((fa) => fa.files || [])) : [];

    fill(view, 
      h('section', { class: 'course-head' }, h('h1', { title: toText(a.name) }, toText(a.name))),
      h('section', { class: 'card' }, meta),
      intro || introFiles.length
        ? h('section', { class: 'block' },
          h('h2', null, 'Leírás'),
          intro ? h('p', { class: 'text' }, intro) : null,
          introFiles.length ? h('div', { class: 'files card' }, introFiles.map(fileRow)) : null)
        : null,
      h('section', { class: 'block' },
        h('h2', null, 'Beadott munka'),
        existing.length ? h('div', { class: 'files card' }, existing.map(fileRow)) : h('p', { class: 'empty' }, 'Nincs beadott fájl.'),
        existingText ? h('p', { class: 'text card' }, toText(existingText)) : null),
      feedback && (feedback.gradefordisplay || feedbackText || feedbackFiles.length)
        ? h('section', { class: 'block' },
          h('h2', null, 'Visszajelzés'),
          feedback.gradefordisplay ? h('p', { class: 'grade num' }, toText(feedback.gradefordisplay)) : null,
          feedbackText ? h('p', { class: 'text' }, feedbackText) : null,
          feedbackFiles.length ? h('div', { class: 'files card' }, feedbackFiles.map(fileRow)) : null)
        : null,
      submissionEditor({ courseid, cmid, a, la, fileEnabled, textEnabled, existing, existingText })
    );
  }

  function fact(label, value, note, tone) {
    return h('div', { class: `fact${tone ? ` tone-${tone}` : ''}` },
      h('dt', null, label),
      h('dd', { class: 'num' }, value, note ? h('span', { class: 'muted' }, ` (${note})`) : null));
  }

  // Upload flow, in two explicit steps:
  //   1. "Feltöltés piszkozatba": files go to a draft area on the server (upload.php -> itemid).
  //      Nothing about the submission changes yet.
  //   2. "Mentés a beadásba…": after a confirmation dialog, mod_assign_save_submission points the
  //      submission at that draft area. Moodle replaces the submission's files with the draft's,
  //      so files the user keeps are re-uploaded into the same draft first.
  // Submit-for-grading is never called by this app.
  function submissionEditor({ courseid, cmid, a, la, fileEnabled, textEnabled, existing, existingText }) {
    const wrap = h('section', { class: 'block' }, h('h2', null, 'Beadás szerkesztése'));
    const reasons = [];
    if (!fileEnabled) reasons.push('Ennél a feladatnál nincs fájlfeltöltés.');
    else if (!la.canedit) reasons.push(la.locked ? 'A beadás zárolva van.' : 'A beadásod jelenleg nem szerkeszthető.');
    else if (!session.uploadfiles || !hasFn('mod_assign_save_submission')) reasons.push('Ez a Moodle-oldal nem engedi a feltöltést az alkalmazásokból.');
    else if (textEnabled && toText(existingText)) reasons.push('Ennél a feladatnál szöveges beadás is van. Hogy a szöveg ne vesszen el, a fájlokat a Moodle weboldalán módosítsd.');
    if (reasons.length) {
      wrap.append(h('p', { class: 'note' }, reasons.join(' ')));
      return wrap;
    }

    const maxFiles = Number(cfg(a, 'file', 'assignsubmission', 'maxfilesubmissions')) || 0;
    const maxBytes = Number(cfg(a, 'file', 'assignsubmission', 'maxsubmissionsizebytes')) || 0;
    const types = (cfg(a, 'file', 'assignsubmission', 'filetypeslist') || '').split(/[,;\s]+/).filter(Boolean);
    const accept = types.length && types.every((t) => t.startsWith('.')) ? types.join(',') : null;

    // items: { kind: 'existing', file, keep } | { kind: 'new', file: File }
    const items = existing.map((f) => ({ kind: 'existing', file: f, keep: true }));
    let draft = null; // { itemid, names }

    const limits = [
      maxFiles ? `Legfeljebb ${maxFiles} fájl` : null,
      maxBytes ? `fájlonként legfeljebb ${fileSize(maxBytes)}` : null,
      types.length ? `típusok: ${types.join(', ')}` : null
    ].filter(Boolean).join(', ');

    const listEl = h('div', { class: 'files card' });
    const input = h('input', { type: 'file', multiple: true, accept, hidden: true });
    const addBtn = h('button', { class: 'btn', type: 'button', onclick: () => input.click() }, icon('plus'), 'Fájlok hozzáadása');
    const uploadBtn = h('button', { class: 'btn btn-primary', type: 'button' }, icon('upload'), 'Feltöltés piszkozatba');
    const progress = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
    const draftBox = h('div', { class: 'draft', hidden: true });

    const kept = () => items.filter((it) => it.kind === 'new' || it.keep);

    function invalidate() {
      draft = null;
      draftBox.hidden = true;
      fill(draftBox);
      uploadBtn.disabled = !kept().length;
    }

    function renderList() {
      fill(listEl, ...(items.length ? items.map((it, i) => {
        const fname = it.kind === 'new' ? it.file.name : it.file.filename;
        const size = it.kind === 'new' ? it.file.size : it.file.filesize;
        const removed = it.kind === 'existing' && !it.keep;
        const toggle = h('button', {
          class: 'icon-btn', type: 'button',
          title: removed ? 'Visszaállítás' : 'Eltávolítás',
          'aria-label': `${removed ? 'Visszaállítás' : 'Eltávolítás'}: ${fname}`,
          onclick: () => {
            if (it.kind === 'existing') it.keep = !it.keep;
            else items.splice(i, 1);
            invalidate();
            renderList();
          }
        }, icon(removed ? 'refresh' : 'x'));
        return h('div', { class: `file${removed ? ' is-removed' : ''}` },
          icon(it.kind === 'new' ? 'upload' : 'file', 'icon icon-dim'),
          h('span', { class: 'file-name', title: fname }, fname),
          h('span', { class: 'file-tag' }, it.kind === 'new' ? 'új' : removed ? 'törlődik' : 'megmarad'),
          h('span', { class: 'file-size num' }, fileSize(size)),
          toggle);
      }) : [h('p', { class: 'empty' }, 'Nincs kiválasztott fájl.')]));
      uploadBtn.disabled = !kept().length;
    }

    input.addEventListener('change', () => {
      for (const file of input.files) items.push({ kind: 'new', file });
      input.value = '';
      invalidate();
      renderList();
    });

    function validate() {
      const files = kept();
      if (!files.length) return 'Válassz ki legalább egy fájlt.';
      if (maxFiles && files.length > maxFiles) return `Legfeljebb ${maxFiles} fájlt adhatsz be.`;
      const names = files.map((it) => (it.kind === 'new' ? it.file.name : it.file.filename));
      const dup = names.find((n, i) => names.indexOf(n) !== i);
      if (dup) return `Két fájlnak ugyanaz a neve: ${dup}`;
      const big = files.find((it) => it.kind === 'new' && maxBytes && it.file.size > maxBytes);
      if (big) return `Túl nagy fájl: ${big.file.name} (legfeljebb ${fileSize(maxBytes)})`;
      // Mobile file pickers ignore `accept` and upload.php does not check types, so check here.
      // Only plain extension lists are enforced; Moodle type groups ("document", "image/*") are left to the server.
      if (accept) {
        const allowed = types.map((t) => t.toLowerCase());
        const wrong = files.find((it) => it.kind === 'new' && !allowed.some((ext) => it.file.name.toLowerCase().endsWith(ext)));
        if (wrong) return `Nem megengedett fájltípus: ${wrong.file.name} (megengedett: ${types.join(', ')})`;
      }
      return null;
    }

    uploadBtn.addEventListener('click', async () => {
      const problem = validate();
      if (problem) return announce(problem, 'error');
      invalidate();
      uploadBtn.disabled = true;
      addBtn.disabled = true;
      try {
        const files = kept();
        const payload = [];
        const keepers = files.filter((it) => it.kind === 'existing');
        for (const [i, it] of keepers.entries()) {
          progress.textContent = `Meglévő fájlok előkészítése (${i + 1}/${keepers.length})…`;
          payload.push({ name: it.file.filename, blob: await client.fetchFile(it.file.fileurl) });
        }
        for (const it of files.filter((x) => x.kind === 'new')) payload.push({ name: it.file.name, blob: it.file });
        progress.textContent = 'Feltöltés…';
        const itemid = await client.upload(payload);
        draft = { itemid, names: payload.map((p) => p.name) };
        progress.textContent = '';
        renderDraft();
      } catch (err) {
        progress.textContent = '';
        if (err.auth) return signOut(err.message);
        announce(err.message, 'error');
      } finally {
        addBtn.disabled = false;
        uploadBtn.disabled = Boolean(draft) || !kept().length;
      }
    });

    function renderDraft() {
      const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, icon('check'), 'Mentés a beadásba…');
      const dropBtn = h('button', { class: 'btn', type: 'button', onclick: invalidate }, 'Elvetés');
      fill(draftBox, 
        h('p', null, h('strong', null, 'A piszkozat feltöltve a Moodle-szerverre '), h('span', { class: 'num' }, `(${draft.names.length} fájl).`)),
        h('p', { class: 'muted' }, 'A beadásod még nem változott. Mentéskor ezek a fájlok lesznek a beadásodban.'),
        h('div', { class: 'actions' }, saveBtn, dropBtn));
      draftBox.hidden = false;
    }

    async function save() {
      if (!draft) return;
      const finalSubmit = !a.submissiondrafts;
      const body = h('div', null,
        h('p', null, 'A beadásod fájljai lecserélődnek erre:'),
        h('ul', { class: 'names' }, draft.names.map((n) => h('li', { title: n }, n))),
        finalSubmit
          ? h('p', { class: 'warn' }, icon('alert'), 'Figyelem: ennél a feladatnál a mentés egyben be is adja a munkát értékelésre.')
          : h('p', { class: 'muted' }, 'A munka piszkozatként mentődik. Értékelésre a Moodle weboldalán tudod beadni.'));
      const answer = await openDialog('Mentés a beadásba', body,
        [['cancel', 'Mégse'], ['ok', finalSubmit ? 'Mentés és beadás' : 'Mentés', 'btn-primary']]);
      if (answer !== 'ok') return;
      const plugindata = { files_filemanager: draft.itemid };
      if (textEnabled) plugindata.onlinetext_editor = { text: '', format: 1, itemid: 0 };
      announce('Mentés…');
      try {
        const warnings = await client.call('mod_assign_save_submission', { assignmentid: a.id, plugindata });
        const list = Array.isArray(warnings) ? warnings : (warnings && warnings.warnings) || [];
        if (list.length) {
          announce(list.map((w) => toText(w.message || w.warningcode)).join(' '), 'error');
          return;
        }
        announce('A beadás mentve.', 'success');
        memo.delete(`assigns:${courseid}`);
        showAssign(courseid, cmid);
      } catch (err) {
        if (err.auth) return signOut(err.message);
        announce(err.message, 'error');
      }
    }

    renderList();
    wrap.append(
      limits ? h('p', { class: 'muted' }, limits + '.') : null,
      listEl,
      input,
      h('div', { class: 'actions' }, addBtn, uploadBtn),
      progress,
      draftBox);
    return wrap;
  }

  // ---------------------------------------------------------------- routing
  function route() {
    // #/install (the website's "Telepítés" link): show the normal start screen plus install help.
    if (/^#\/?install$/.test(location.hash)) {
      history.replaceState(null, '', location.pathname + location.search + '#/');
      waitForInstallEvent(1500).then(openInstallDialog);
    }
    if (!session) return showLogin();
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const num = (v) => (/^\d+$/.test(v || '') ? Number(v) : null);
    if (parts[0] === 'course' && num(parts[1])) return showCourse(num(parts[1]));
    if (parts[0] === 'assign' && num(parts[1]) && num(parts[2])) return showAssign(num(parts[1]), num(parts[2]));
    if (parts[0] === 'video' && num(parts[1]) && num(parts[2])) return showVideo(num(parts[1]), num(parts[2]));
    return showDashboard();
  }

  window.addEventListener('hashchange', () => {
    window.scrollTo(0, 0);
    route();
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event;
    renderActions();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    renderActions();
  });

  applyTheme(store.get(THEME_KEY) || 'auto');
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme(store.get(THEME_KEY) || 'auto'));
  route();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker registration failed', err));
  }
})();
