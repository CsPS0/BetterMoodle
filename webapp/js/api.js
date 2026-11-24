// BetterMoodle web app: Moodle mobile web-service client.
//
// Endpoints (all send Access-Control-Allow-Origin: *, so no proxy is needed):
//   POST <site>/login/token.php                 username, password, service -> { token }
//   POST <site>/webservice/rest/server.php      wstoken, wsfunction, params  -> JSON
//   POST <site>/webservice/upload.php           token, itemid, files         -> [{ itemid, filename, ... }]
//   GET  <site>/webservice/pluginfile.php/...?token=                         -> file bytes
//
// Moodle answers CORS for simple requests only, so every request uses a
// URLSearchParams or FormData body and no custom headers (no preflight).
// The token travels in the POST body; only file downloads put it in the URL.
'use strict';

(function (root) {
  const SERVICE = 'moodle_mobile_app';

  class MoodleError extends Error {
    constructor(errorcode, message, { auth = false, network = false } = {}) {
      super(message || errorcode || 'Ismeretlen hiba');
      this.name = 'MoodleError';
      this.errorcode = errorcode || '';
      this.auth = auth; // token no longer valid: the app sends the user back to login
      this.network = network;
    }
  }

  // Hungarian messages for the error codes a student is likely to meet.
  const MESSAGES = {
    invalidlogin: 'Hibás felhasználónév vagy jelszó.',
    servicenotavailable: 'Ezen a Moodle-oldalon nincs engedélyezve a mobilalkalmazás-szolgáltatás.',
    enablewsdescription: 'Ezen a Moodle-oldalon ki vannak kapcsolva a webszolgáltatások.',
    passwordisexpired: 'A jelszavad lejárt. Változtasd meg a Moodle weboldalán, majd próbáld újra.',
    sitemaintenance: 'A Moodle-oldal karbantartás alatt áll.',
    usernotconfirmed: 'A fiókod még nincs megerősítve.',
    restoredaccountresetpassword: 'A fiókodhoz új jelszót kell beállítanod a Moodle weboldalán.',
    noguest: 'Vendégfiókkal nem lehet bejelentkezni.',
    sitepolicynotagreed: 'Előbb fogadd el az oldal szabályzatát a Moodle weboldalán, majd jelentkezz be újra.',
    invalidtoken: 'A bejelentkezésed lejárt. Jelentkezz be újra.',
    userquotalimit: 'Elfogyott a tárhelyed a Moodle-oldalon.',
    filenameexist: 'Ilyen nevű fájl már van a piszkozatban.',
    fileoversized: 'A fájl nagyobb a megengedettnél.',
    nopermissions: 'Ehhez nincs jogosultságod.',
    requireloginerror: 'Ehhez a kurzushoz nincs hozzáférésed.',
    submissionslocked: 'A beadás zárolva van.'
  };

  function messageFor(code, fallback) {
    return MESSAGES[code] || fallback || code || 'Ismeretlen hiba';
  }

  // Encodes nested params the way Moodle's REST server reads them:
  // { courseids: [3], options: [{ name: 'x', value: 1 }] } -> courseids[0]=3&options[0][name]=x&...
  function encode(params, form = new URLSearchParams(), prefix = '') {
    for (const [key, value] of Object.entries(params || {})) {
      if (value === undefined || value === null) continue;
      const name = prefix ? `${prefix}[${key}]` : key;
      if (Array.isArray(value)) {
        value.forEach((v, i) => {
          if (v !== null && typeof v === 'object') encode(v, form, `${name}[${i}]`);
          else form.append(`${name}[${i}]`, scalar(v));
        });
      } else if (typeof value === 'object') {
        encode(value, form, name);
      } else {
        form.append(name, scalar(value));
      }
    }
    return form;
  }
  const scalar = (v) => (typeof v === 'boolean' ? (v ? '1' : '0') : String(v));

  async function readJson(response) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new MoodleError('invalidresponse', 'A Moodle-oldal nem a várt választ adta. Ellenőrizd a címet.');
    }
  }

  async function post(url, body) {
    let response;
    try {
      response = await fetch(url, { method: 'POST', body, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    } catch {
      throw new MoodleError('network', 'Nem sikerült elérni a Moodle-oldalt. Ellenőrizd a címet és az internetkapcsolatot.', { network: true });
    }
    if (!response.ok) {
      throw new MoodleError(`http${response.status}`, `A Moodle-oldal hibát jelzett (HTTP ${response.status}).`);
    }
    return readJson(response);
  }

  // REST errors are { exception, errorcode, message }; AJAX_SCRIPT endpoints
  // (token.php, upload.php) send { error, errorcode }.
  function errorFrom(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (data.exception || data.error) {
      const code = data.errorcode || '';
      const raw = data.message || data.error || '';
      return new MoodleError(code, messageFor(code, raw), { auth: code === 'invalidtoken' });
    }
    return null;
  }

  async function login(site, username, password) {
    const body = new URLSearchParams({ username, password, service: SERVICE });
    const data = await post(`${site}/login/token.php`, body);
    const err = errorFrom(data);
    if (err) throw err;
    if (!data || typeof data.token !== 'string' || !data.token) {
      throw new MoodleError('notoken', 'A Moodle-oldal nem adott tokent.');
    }
    // privatetoken is deliberately dropped: the app never needs it.
    return data.token;
  }

  function createClient(site, token) {
    async function rawCall(wsfunction, params) {
      const body = encode(params);
      body.append('wstoken', token);
      body.append('wsfunction', wsfunction);
      body.append('moodlewsrestformat', 'json');
      const url = `${site}/webservice/rest/server.php?moodlewsrestformat=json&wsfunction=${encodeURIComponent(wsfunction)}`;
      const data = await post(url, body);
      const err = errorFrom(data);
      if (err) throw err;
      return data;
    }

    // An expired token arrives as the generic "accessexception", which also covers
    // other refusals. Re-probe site info: if that fails too, the token is dead.
    async function call(wsfunction, params = {}) {
      try {
        return await rawCall(wsfunction, params);
      } catch (err) {
        if (err instanceof MoodleError && err.errorcode === 'accessexception' && wsfunction !== 'core_webservice_get_site_info') {
          try {
            await rawCall('core_webservice_get_site_info', {});
          } catch (probe) {
            if (probe instanceof MoodleError && (probe.auth || probe.errorcode === 'accessexception')) {
              throw new MoodleError(probe.errorcode, messageFor('invalidtoken'), { auth: true });
            }
          }
        } else if (err instanceof MoodleError && err.errorcode === 'accessexception') {
          throw new MoodleError(err.errorcode, messageFor('invalidtoken'), { auth: true });
        }
        throw err;
      }
    }

    // Uploads files into one draft area; returns its itemid. A file-level error
    // (oversized, duplicate name) comes back inside a 200 response and is thrown here.
    async function upload(files, itemid = 0) {
      const body = new FormData();
      body.append('token', token);
      body.append('filearea', 'draft');
      body.append('itemid', String(itemid));
      files.forEach((f, i) => body.append(`file_${i + 1}`, f.blob, f.name));
      const data = await post(`${site}/webservice/upload.php`, body);
      const err = errorFrom(data);
      if (err) throw err;
      if (!Array.isArray(data) || !data.length) throw new MoodleError('uploadfailed', 'A feltöltés nem sikerült.');
      const bad = data.find((r) => r && r.error);
      if (bad) {
        throw new MoodleError(bad.errortype || 'uploadfailed', `${bad.filename || 'Fájl'}: ${messageFor(bad.errortype, bad.error)}`);
      }
      return Number(data[0].itemid);
    }

    // Moodle returns file URLs for web-service clients under /webservice/pluginfile.php;
    // a plain /pluginfile.php URL is rewritten. Only URLs on this site get the token.
    function fileUrl(url) {
      let u;
      try {
        u = new URL(url, site + '/');
      } catch {
        return null;
      }
      const siteUrl = new URL(site + '/');
      if (u.origin !== siteUrl.origin) return null;
      const base = siteUrl.pathname.replace(/\/$/, '');
      if (u.pathname.startsWith(`${base}/pluginfile.php/`)) {
        u.pathname = `${base}/webservice/pluginfile.php/` + u.pathname.slice(`${base}/pluginfile.php/`.length);
      }
      if (!u.pathname.startsWith(`${base}/webservice/pluginfile.php/`)) return null;
      u.searchParams.set('token', token);
      return u.toString();
    }

    async function fetchFile(url) {
      const signed = fileUrl(url);
      if (!signed) throw new MoodleError('badfileurl', 'Ez a fájl nem tölthető le az alkalmazásból.');
      let response;
      try {
        response = await fetch(signed, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
      } catch {
        throw new MoodleError('network', 'Nem sikerült letölteni a fájlt.', { network: true });
      }
      const type = response.headers.get('content-type') || '';
      if (type.includes('application/json')) {
        const err = errorFrom(await readJson(response));
        if (err) throw err;
      }
      if (!response.ok) throw new MoodleError(`http${response.status}`, `A letöltés nem sikerült (HTTP ${response.status}).`);
      return response.blob();
    }

    return { site, call, upload, fileUrl, fetchFile };
  }

  root.BMApi = { login, createClient, MoodleError, messageFor, encode };
})(globalThis);
