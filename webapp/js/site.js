// BetterMoodle web app: Moodle site address handling.
// Port of normaliseSite() from the Android wrapper (MainActivity.java), so both apps
// accept the same input: a bare host, a full address, or any pasted Moodle page link.
'use strict';

(function (root) {
  const PAGE_DIRS = /\/(login|my|course|mod|user|calendar|grade|message|admin|pluginfile\.php|webservice)(\/.*)?$/i;

  function isLoopback(host) {
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  }

  // Returns the site root ("https://host[:port][/path]", no trailing slash) or null.
  // HTTPS only; plain http is allowed for localhost so a local test server works.
  function normaliseSite(raw) {
    if (typeof raw !== 'string') return null;
    let s = raw.trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
    let u;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    const host = u.hostname.toLowerCase();
    if (!host) return null;
    const scheme = u.protocol.toLowerCase();
    if (scheme !== 'https:' && !(scheme === 'http:' && isLoopback(host))) return null;
    if (!host.includes('.') && !isLoopback(host)) return null;
    if (u.username || u.password) return null;
    let path = u.pathname || '';
    path = path.replace(PAGE_DIRS, '');
    path = path.replace(/\/index\.php$/i, '');
    path = path.replace(/\/+$/, '');
    return `${scheme}//${u.host.toLowerCase()}${path}`;
  }

  root.BMSite = { normaliseSite };
})(globalThis);
