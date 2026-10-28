// Background Service Worker for PixelMeasure Pro

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Inject content script safely into active tab
async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js']
    });
    return true;
  } catch (err) {
    console.warn("PixelMeasure: Cannot inject into page", err);
    return false;
  }
}

// Toggle ruler overlay on a tab (Optimized: single round-trip fast path)
async function toggleRuler(tab, optionalMode) {
  if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
    return { success: false, reason: 'restricted_url' };
  }

  // Fast path: try sending message directly if already injected
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'TOGGLE_RULER',
      mode: optionalMode
    });
    updateBadge(tab.id, response?.active);
    return { success: true, active: response?.active, mode: response?.mode };
  } catch {
    // Fallback: inject content script once and retry
    const injected = await ensureContentScriptInjected(tab.id);
    if (!injected) return { success: false, reason: 'injection_failed' };

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'TOGGLE_RULER',
        mode: optionalMode
      });
      updateBadge(tab.id, response?.active);
      return { success: true, active: response?.active, mode: response?.mode };
    } catch (err) {
      console.error("PixelMeasure: Failed to communicate with tab", err);
      return { success: false, reason: err.message };
    }
  }
}

// Set mode on a tab (with optional auto-activation)
async function setMode(tab, mode, activateIfInactive = false) {
  if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
    return { success: false, reason: 'restricted_url' };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'SET_MODE',
      mode,
      activateIfInactive
    });
    if (response?.active !== undefined) {
      updateBadge(tab.id, response.active);
    }
    return { success: true, active: response?.active, mode: response?.mode || mode };
  } catch {
    // If not injected and activation requested, toggle directly with mode
    if (activateIfInactive) {
      return await toggleRuler(tab, mode);
    }
    return { success: false };
  }
}

// Update icon badge (ON / empty)
function updateBadge(tabId, isActive) {
  if (isActive) {
    chrome.action.setBadgeText({ tabId, text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#0ea5e9' });
  } else {
    chrome.action.setBadgeText({ tabId, text: '' });
  }
}

// Keyboard shortcut listener
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-ruler') {
    const tab = await getActiveTab();
    if (tab) {
      await toggleRuler(tab);
    }
  }
});

// Clean up badge state on navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    updateBadge(tabId, false);
  }
});

// Listener for messages from popup or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'TOGGLE_FROM_POPUP') {
    (async () => {
      const tab = await getActiveTab();
      const res = await toggleRuler(tab, request.mode);
      sendResponse(res);
    })();
    return true;
  }

  if (request.action === 'GET_STATUS_FROM_POPUP') {
    (async () => {
      const tab = await getActiveTab();
      if (!tab || !tab.id) {
        sendResponse({ active: false });
        return;
      }
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_STATUS' });
        sendResponse(response || { active: false });
      } catch {
        sendResponse({ active: false });
      }
    })();
    return true;
  }

  if (request.action === 'SET_MODE_FROM_POPUP') {
    (async () => {
      const tab = await getActiveTab();
      if (tab?.id) {
        const res = await setMode(tab, request.mode, request.activateIfInactive);
        sendResponse(res);
      } else {
        sendResponse({ success: false });
      }
    })();
    return true;
  }

  if (request.action === 'OVERLAY_STATE_CHANGED' && sender.tab?.id) {
    updateBadge(sender.tab.id, request.active);
  }
});
