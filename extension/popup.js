const loginView = document.getElementById("login-view");
const codeView = document.getElementById("code-view");
const mainView = document.getElementById("main-view");
const statusEl = document.getElementById("status");
const statusDot = document.getElementById("status-dot");
const userCodeEl = document.getElementById("user-code");

async function init() {
  const { loggedIn, daemonConnected } = await browser.runtime.sendMessage({ type: "getStatus" });
  
  if (loggedIn || daemonConnected) {
    showMain(daemonConnected);
  } else {
    showLogin();
  }
}

function showLogin() {
  loginView.classList.remove("hidden");
  codeView.classList.add("hidden");
  mainView.classList.add("hidden");
}

function showCode(code) {
  loginView.classList.add("hidden");
  codeView.classList.remove("hidden");
  mainView.classList.add("hidden");
  userCodeEl.textContent = code;
}

function showMain(daemonConnected) {
  loginView.classList.add("hidden");
  codeView.classList.add("hidden");
  mainView.classList.remove("hidden");
  
  if (daemonConnected) {
    statusEl.textContent = "Connected to daemon";
    statusDot.classList.remove("offline");
  } else {
    statusEl.textContent = "Standalone mode";
    statusDot.classList.remove("offline");
  }
}

document.getElementById("login-btn").addEventListener("click", async () => {
  const result = await browser.runtime.sendMessage({ type: "login" });
  if (result.user_code) {
    showCode(result.user_code);
    const pollResult = await result.pollPromise;
    if (pollResult.ok) {
      const { daemonConnected } = await browser.runtime.sendMessage({ type: "getStatus" });
      showMain(daemonConnected);
    } else {
      showLogin();
      alert("Login failed: " + (pollResult.error || "unknown error"));
    }
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "logout" });
  showLogin();
});

document.getElementById("refresh-btn").addEventListener("click", async () => {
  statusEl.textContent = "Refreshing...";
  await browser.runtime.sendMessage({ type: "refresh" });
  setTimeout(() => init(), 500);
});

document.getElementById("group-btn").addEventListener("click", async () => {
  statusEl.textContent = "Grouping...";
  await browser.runtime.sendMessage({ type: "groupByDomain" });
  setTimeout(() => init(), 500);
});

init();
