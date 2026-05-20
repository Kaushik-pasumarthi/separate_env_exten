// popup.js

document.addEventListener('DOMContentLoaded', loadEnvironments);

document.getElementById('createBtn').addEventListener('click', async () => {
  const nameInput = document.getElementById('envName');
  const name = nameInput.value.trim();
  if (!name) return;

  const newWin = await chrome.windows.create({ focused: true });

  const data = await chrome.storage.local.get("environments");
  const envs = data.environments || {};
  // Initialize with empty URL array
  envs[name] = { windowId: newWin.id, status: 'active', urls: [] };
  await chrome.storage.local.set({ environments: envs });

  nameInput.value = '';
  loadEnvironments();
});

async function loadEnvironments() {
  const envList = document.getElementById('envList');
  envList.innerHTML = '';

  const data = await chrome.storage.local.get("environments");
  const envs = data.environments || {};

  for (const [name, envData] of Object.entries(envs)) {
    const el = document.createElement('div');
    el.className = 'env-item';

    const statusColor = envData.status === 'active' ? '#3fb950' : '#ff7b72';
    const tabCount = envData.urls ? envData.urls.length : 0;

    el.innerHTML = `
      <span class="env-name"><span style="color:${statusColor}">●</span> ${name} <span style="font-size:10px; color:#8b949e">[${tabCount} tabs]</span></span>
      <div class="controls">
        <button class="btn-resume" data-name="${name}">Resume</button>
        <button class="btn-pause" data-name="${name}">Pause</button>
      </div>
    `;
    envList.appendChild(el);
  }

  document.querySelectorAll('.btn-pause').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const name = e.target.dataset.name;
      const data = await chrome.storage.local.get("environments");
      if (data.environments[name]) pauseEnvironment(data.environments[name].windowId);
    });
  });

  document.querySelectorAll('.btn-resume').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const name = e.target.dataset.name;
      resumeEnvironment(name);
    });
  });
}

async function pauseEnvironment(windowId) {
  try {
    const tabs = await chrome.tabs.query({ windowId: windowId });
    for (let tab of tabs) {
      if (!tab.active) await chrome.tabs.discard(tab.id);
    }
    await chrome.windows.update(windowId, { state: 'minimized' });
  } catch (error) {
    console.error("Failed to pause environment:", error);
  }
}

// THE ULTIMATE RESURRECTION ENGINE
async function resumeEnvironment(envName) {
  try {
    const data = await chrome.storage.local.get("environments");
    const envData = (data.environments || {})[envName];

    if (!envData) throw new Error("GHOST");

    if (envData.status === 'closed' && envData.sessionId) {
      const restored = await chrome.sessions.restore(envData.sessionId);
      data.environments[envName].windowId = restored.window.id;
      data.environments[envName].status = 'active';
      delete data.environments[envName].sessionId;
      await chrome.storage.local.set({ environments: data.environments });
      loadEnvironments();
    } else {
      await chrome.windows.update(envData.windowId, { state: 'normal', focused: true });
    }
  } catch (error) {
    // FINGERPRINT PROTOCOL: Chrome broke the ID or we closed multiple windows
    console.warn(`[${envName}] Native resume failed. Engaging Fingerprint Protocol...`);

    const data = await chrome.storage.local.get("environments");
    const envData = data.environments[envName];
    const savedUrls = envData.urls || [];

    try {
      const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 15 });
      let targetSessionId = null;

      // 1. Search the graveyard for our fingerprint (Do these closed tabs match our saved URLs?)
      for (let s of sessions) {
        if (s.window && s.window.tabs) {
          const sessionUrls = s.window.tabs.map(t => t.url);
          // If we find a window where at least one major URL matches, it's our guy
          const hasMatch = sessionUrls.some(url => savedUrls.includes(url) && !url.startsWith('chrome'));
          if (hasMatch) {
            targetSessionId = s.window.sessionId;
            break;
          }
        }
      }

      if (targetSessionId) {
        // True Resurrection
        console.log("Fingerprint match found! Restoring true session.");
        const restored = await chrome.sessions.restore(targetSessionId);
        envData.windowId = restored.window.id;
      } else if (savedUrls.length > 0) {
        // Ultimate Failsafe Rebuild
        console.warn("Session permanently purged by Chrome. Rebuilding from memory.");
        const newWin = await chrome.windows.create({ url: savedUrls, focused: true });
        envData.windowId = newWin.id;
      } else {
        throw new Error("No URLs saved.");
      }

      // Update Database
      envData.status = 'active';
      delete envData.sessionId;
      await chrome.storage.local.set({ environments: data.environments });
      loadEnvironments();

    } catch (fatalError) {
      alert(`CRITICAL: Environment ${envName} could not be recovered.`);
    }
  }
}