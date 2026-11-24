// ==========================================================================
// BetterMoodle Android bridge
// Prepended (by MainActivity) to the unchanged extension content.js and
// injected at document start, top frame only, on the user's Moodle origin.
// MainActivity defines BM_VERSION and BM_CSS right before this file.
// Only chrome.runtime is shimmed: content.js already falls back to
// localStorage when chrome.storage is missing, which the WebView persists.
// ==========================================================================
/* global BM_VERSION, BM_CSS */
(function () {
  'use strict';

  // window.BetterMoodleAndroid is the origin-restricted WebMessageListener object
  function postToApp(message) {
    try {
      window.BetterMoodleAndroid.postMessage(JSON.stringify(message));
      return true;
    } catch (_) {
      return false;
    }
  }

  var chromeObj = window.chrome || {};
  if (!chromeObj.runtime || !chromeObj.runtime.sendMessage) {
    chromeObj.runtime = {
      lastError: undefined,
      getManifest: function () {
        return { name: 'BetterMoodle', version: BM_VERSION };
      },
      sendMessage: function (message, callback) {
        var ok = false;
        if (message && message.type === 'DOWNLOAD_FILE' && message.url) {
          var url = '';
          try { url = new URL(message.url, window.location.href).href; } catch (_) {}
          ok = Boolean(url) && postToApp({ type: 'DOWNLOAD_FILE', url: url, filename: message.filename || '' });
        }
        if (typeof callback === 'function') {
          setTimeout(function () { callback({ ok: ok }); }, 0);
        }
      },
      onMessage: { addListener: function () {}, removeListener: function () {} }
    };
  }
  try { window.chrome = chromeObj; } catch (_) {}

  // content.css is scoped to html[data-mp-active="true"], so adding it early is
  // inert until content.js activates, but avoids a restyle flash once it does.
  function addStyle() {
    if (document.getElementById('bm-android-css')) return;
    var style = document.createElement('style');
    style.id = 'bm-android-css';
    style.textContent = BM_CSS;
    (document.head || document.documentElement).appendChild(style);
  }
  if (document.documentElement) {
    addStyle();
  } else {
    document.addEventListener('readystatechange', addStyle, { once: true });
  }

  function isShown(el) {
    return Boolean(el && el.getClientRects().length);
  }

  // Android back button: close whatever is open on top of the page before leaving it,
  // so a half-filled upload form is not lost. Returns true when something was closed.
  window.__bmAndroidBack = function () {
    var host = document.getElementById('mp-shadow-host');
    var shadow = host && host.shadowRoot;
    if (shadow) {
      var modalRoot = shadow.getElementById('mp-modal-root');
      var drawer = shadow.getElementById('mp-customizer-drawer');
      if ((modalRoot && modalRoot.innerHTML.trim() !== '') || (drawer && drawer.classList.contains('open'))) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return true;
      }
    }
    var dialogs = document.querySelectorAll('.moodle-dialogue-base .moodle-dialogue:not(.moodle-dialogue-hidden) .closebutton');
    for (var i = dialogs.length - 1; i >= 0; i--) {
      if (isShown(dialogs[i])) {
        dialogs[i].click();
        return true;
      }
    }
    var modalClose = document.querySelector('.modal.show [data-action="hide"], .modal.show .btn-close, .modal.show .close');
    if (isShown(modalClose)) {
      modalClose.click();
      return true;
    }
    var sidebar = document.querySelector('#mp-sidebar.mp-sidebar-open');
    if (sidebar) {
      sidebar.classList.remove('mp-sidebar-open');
      return true;
    }
    return false;
  };
})();
