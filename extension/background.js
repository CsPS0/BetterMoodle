// ==========================================================================
// BetterMoodle - Background Service Worker
// ==========================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'DOWNLOAD_FILE') {
    (async () => {
      try {
        const downloadId = await chrome.downloads.download({
          url: message.url,
          filename: message.filename || undefined,
          saveAs: Boolean(message.saveAs)
        });
        sendResponse({ ok: true, downloadId });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Download failed' });
      }
    })();
    return true;
  }

  if (message?.type === 'OPEN_SIDE_PANEL') {
    // Firefox: sidebar instead of side panel. It only opens from a user action, so this may be refused.
    const sidebar = (globalThis.browser || chrome).sidebarAction;
    if (!chrome.sidePanel && sidebar && typeof sidebar.open === 'function') {
      sidebar.open()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err?.message || 'Unable to open sidebar' }));
      return true;
    }
    (async () => {
      try {
        let windowId = sender?.tab?.windowId || message.windowId;
        if (!windowId) {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          windowId = activeTab?.windowId;
        }
        if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function' && windowId) {
          await chrome.sidePanel.open({ windowId });
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: 'Side panel API unavailable' });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Unable to open side panel' });
      }
    })();
    return true;
  }

  return false;
});
