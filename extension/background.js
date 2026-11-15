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
