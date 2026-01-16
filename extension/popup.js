const loginView = document.getElementById("login-view");
const codeView = document.getElementById("code-view");
const mainView = document.getElementById("main-view");
const statusEl = document.getElementById("status");
const userCodeEl = document.getElementById("user-code");

async function init() {
  const { loggedIn, daemonConnected, config } = await browser.runtime.sendMessage({ type: "getStatus" });
  
  if (loggedIn || daemonConnected) {
    showMain(daemonConnected, config);
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

function showMain(daemonConnected, config) {
  loginView.classList.add("hidden");
  codeView.classList.add("hidden");
  mainView.classList.remove("hidden");
  
  document.getElementById("review-toggle").checked = config.includeReview;
  statusEl.textContent = daemonConnected ? "Connected to CLI daemon" : "Standalone mode";
}

document.getElementById("login-btn").addEventListener("click", async () => {
  const result = await browser.runtime.sendMessage({ type: "login" });
  if (result.user_code) {
    showCode(result.user_code);
    const pollResult = await result.pollPromise;
    if (pollResult.ok) {
      const { daemonConnected, config } = await browser.runtime.sendMessage({ type: "getStatus" });
      showMain(daemonConnected, config);
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

document.getElementById("refresh-btn").addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "refresh" });
  statusEl.textContent = "Refreshing...";
  setTimeout(() => init(), 1000);
});

document.getElementById("group-btn").addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "groupByDomain" });
  statusEl.textContent = "Grouping tabs...";
  setTimeout(() => statusEl.textContent = "Done!", 500);
});

document.getElementById("review-toggle").addEventListener("change", (e) => {
  browser.runtime.sendMessage({ type: "setConfig", config: { includeReview: e.target.checked } });
});

init();
