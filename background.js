// background.js

// Utility to sync the live URLs of an active environment
async function syncEnvironmentUrls(windowId) {
  const data = await chrome.storage.local.get("environments");
  const envs = data.environments || {};

  const envName = Object.keys(envs).find(name => envs[name].windowId === windowId);
  if (envName && envs[envName].status === 'active') {
    try {
      const tabs = await chrome.tabs.query({ windowId: windowId });
      // Save all valid URLs to create our "Fingerprint"
      envs[envName].urls = tabs.map(t => t.url).filter(url => url && !url.startsWith('chrome://'));
      await chrome.storage.local.set({ environments: envs });
    } catch (e) {
      console.error("Tab sync failed", e);
    }
  }
}

// 1. Listen for URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) syncEnvironmentUrls(tab.windowId);
});

// 2. Listen for tabs being moved into the window
chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  syncEnvironmentUrls(attachInfo.newWindowId);
});

// 3. Listen for tabs being closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) syncEnvironmentUrls(removeInfo.windowId);
});

// 4. Handle Window Closing
chrome.windows.onRemoved.addListener(async (windowId) => {
  const data = await chrome.storage.local.get("environments");
  let envs = data.environments || {};

  const envName = Object.keys(envs).find(name => envs[name].windowId === windowId);

  if (envName) {
    // Wait for Chrome to log it, then mark it as closed
    setTimeout(async () => {
      const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 5 });
      const closedWinSession = sessions.find(s => s.window);

      envs[envName].status = 'closed';
      if (closedWinSession) {
        envs[envName].sessionId = closedWinSession.window.sessionId;
      }
      await chrome.storage.local.set({ environments: envs });
    }, 1500);
  }
});