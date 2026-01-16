const githubLogin = document.getElementById("github-login");
const githubCode = document.getElementById("github-code");
const githubConnected = document.getElementById("github-connected");
const statusEl = document.getElementById("status");
const statusDot = document.getElementById("status-dot");
const userCodeEl = document.getElementById("user-code");

async function init() {
  const { loggedIn, daemonConnected } = await browser.runtime.sendMessage({ type: "getStatus" });
  
  if (loggedIn || daemonConnected) {
    showGitHubConnected(daemonConnected);
  } else {
    showGitHubLogin();
  }
}

function showGitHubLogin() {
  githubLogin.classList.remove("hidden");
  githubCode.classList.add("hidden");
  githubConnected.classList.add("hidden");
}

function showGitHubCode(code) {
  githubLogin.classList.add("hidden");
  githubCode.classList.remove("hidden");
  githubConnected.classList.add("hidden");
  userCodeEl.textContent = code;
}

function showGitHubConnected(daemonConnected) {
  githubLogin.classList.add("hidden");
  githubCode.classList.add("hidden");
  githubConnected.classList.remove("hidden");
  
  statusEl.textContent = daemonConnected ? "Using CLI daemon" : "Syncing PRs";
  statusDot.classList.remove("offline", "warning");
}

// Tab Actions
document.getElementById("group-btn").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "groupByDomain" });
});

document.getElementById("ungroup-btn").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "ungroupAll" });
});

document.getElementById("sort-btn").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "sortTabs" });
});

document.getElementById("close-dupes-btn").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "closeDuplicates" });
});

// GitHub
document.getElementById("login-btn").addEventListener("click", async () => {
  const result = await browser.runtime.sendMessage({ type: "login" });
  if (result.user_code) {
    showGitHubCode(result.user_code);
    const pollResult = await result.pollPromise;
    if (pollResult.ok) {
      const { daemonConnected } = await browser.runtime.sendMessage({ type: "getStatus" });
      showGitHubConnected(daemonConnected);
    } else {
      showGitHubLogin();
      alert("Login failed: " + (pollResult.error || "unknown error"));
    }
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "logout" });
  showGitHubLogin();
});

document.getElementById("refresh-btn").addEventListener("click", async () => {
  statusEl.textContent = "Syncing...";
  await browser.runtime.sendMessage({ type: "refresh" });
  setTimeout(() => init(), 500);
});

init();
