// popup.js

document.addEventListener('DOMContentLoaded', loadEnvironments);

// Master function to handle both "New" and "Current" window creation
async function createEnvironment(isNewWindow) {
  const nameInput = document.getElementById('envName');
  const name = nameInput.value.trim();
  if (!name) return;

  const data = await chrome.storage.local.get("environments");
  const envs = data.environments || {};

  // Prevent accidentally overwriting an existing environment
  if (envs[name]) {
    alert(`An environment named [${name}] already exists!`);
    return;
  }

  let targetWindowId;
  let initialUrls = [];

  if (isNewWindow) {
    // Behavior 1: Open a brand new window
    const newWin = await chrome.windows.create({ focused: true });
    targetWindowId = newWin.id;
  } else {
    // Behavior 2: Capture the current window and scan its tabs immediately
    const currentWin = await chrome.windows.getCurrent();
    targetWindowId = currentWin.id;

    const tabs = await chrome.tabs.query({ windowId: targetWindowId });
    initialUrls = tabs.map(t => t.url).filter(url =>
      url && !url.startsWith('chrome') && !url.startsWith('about:') && !url.startsWith('edge:')
    );
  }

  // Save the environment to the database
  envs[name] = { windowId: targetWindowId, status: 'active', urls: initialUrls };
  await chrome.storage.local.set({ environments: envs });

  nameInput.value = '';
  loadEnvironments();
}

// Wire up the new buttons
document.getElementById('btnNew').addEventListener('click', () => createEnvironment(true));
document.getElementById('btnCurrent').addEventListener('click', () => createEnvironment(false));


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
      <span class="env-name"><span style="color:${statusColor}">●</span> ${name} <br><span style="font-size:10px; color:#8b949e; font-weight:normal;">[${tabCount} tabs tracked]</span></span>
      <div class="controls">
        <button class="btn-resume" data-name="${name}">Resume</button>
        <button class="btn-pause" data-name="${name}">Pause</button>
        <button class="btn-delete" data-name="${name}" title="Delete">X</button>
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

  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const name = e.target.dataset.name;
      if (confirm(`Completely delete the [${name}] environment?`)) {
        const data = await chrome.storage.local.get("environments");
        delete data.environments[name];
        await chrome.storage.local.set({ environments: data.environments });
        loadEnvironments();
      }
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
    const errorMsg = error.message || "";

    if (errorMsg.includes("No window with id") || errorMsg.includes("GHOST") || errorMsg.includes("Invalid session id")) {
      console.warn(`[${envName}] Native resume failed. Engaging Fingerprint Protocol...`);

      const data = await chrome.storage.local.get("environments");
      const envData = data.environments[envName];
      const savedUrls = envData.urls || [];

      try {
        const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 15 });
        let targetSessionId = null;

        for (let s of sessions) {
          if (s.window && s.window.tabs) {
            const sessionUrls = s.window.tabs.map(t => t.url);
            const hasMatch = sessionUrls.some(url => savedUrls.includes(url) && !url.startsWith('chrome'));
            if (hasMatch) {
              targetSessionId = s.window.sessionId;
              break;
            }
          }
        }

        if (targetSessionId) {
          console.log("Fingerprint match found! Restoring true session.");
          const restored = await chrome.sessions.restore(targetSessionId);
          envData.windowId = restored.window.id;
        } else if (savedUrls.length > 0) {
          console.warn("Session permanently purged by Chrome. Rebuilding from memory.");
          const newWin = await chrome.windows.create({ url: savedUrls, focused: true });
          envData.windowId = newWin.id;
        } else {
          throw new Error("No URLs saved.");
        }

        envData.status = 'active';
        delete envData.sessionId;
        await chrome.storage.local.set({ environments: data.environments });
        loadEnvironments();

      } catch (fatalError) {
        alert(`CRITICAL: Environment ${envName} could not be recovered.`);
      }
    } else {
      console.error("Window state update failed:", errorMsg);
    }
  }
}