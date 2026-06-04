// background.js

async function syncEnvironmentUrls(windowId) {
  const data = await chrome.storage.local.get("environments");
  const envs = data.environments || {};

  const envName = Object.keys(envs).find(name => envs[name].windowId === windowId);
  if (envName && envs[envName].status === 'active') {
    try {
      const tabs = await chrome.tabs.query({ windowId: windowId });
      // Stronger filter: Ignore browser-specific utility pages and blank tabs
      envs[envName].urls = tabs.map(t => t.url).filter(url =>
        url && !url.startsWith('chrome') && !url.startsWith('about:') && !url.startsWith('edge:')
      );
      await chrome.storage.local.set({ environments: envs });
    } catch (e) {
      console.error("Tab sync failed", e);
    }
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) syncEnvironmentUrls(tab.windowId);
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  syncEnvironmentUrls(attachInfo.newWindowId);
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) syncEnvironmentUrls(removeInfo.windowId);
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const data = await chrome.storage.local.get("environments");
  let envs = data.environments || {};

  const envName = Object.keys(envs).find(name => envs[name].windowId === windowId);

  if (envName) {
    const savedUrls = envs[envName].urls || [];

    setTimeout(async () => {
      const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 15 });

      let exactSession = null;
      // 1. Scan recent closed windows to find the exact match for our environment
      for (let s of sessions) {
        if (s.window && s.window.tabs) {
          const sessionUrls = s.window.tabs.map(t => t.url);
          const hasMatch = sessionUrls.some(url => savedUrls.includes(url));

          if (hasMatch || savedUrls.length === 0) {
            exactSession = s.window;
            break;
          }
        }
      }

      envs[envName].status = 'closed';

      // 2. Only save the Session ID if we are 100% sure it belongs to us
      if (exactSession) {
        envs[envName].sessionId = exactSession.sessionId;
      } else {
        // If we can't find it, we delete the ID so popup.js is forced to do a Failsafe Rebuild from URLs
        delete envs[envName].sessionId;
      }

      await chrome.storage.local.set({ environments: envs });
    }, 1500);
  }
});