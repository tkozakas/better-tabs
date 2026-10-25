const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.join(__dirname, "..", "..", "extension");
const BACKGROUND_SCRIPTS = ["lib.js", "storage.js", "keepalive.js", "tabs.js", "background.js"];

function createArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      if (keys == null) return structuredClone(data);
      const list = typeof keys === "string" ? [keys] : keys;
      const out = {};
      for (const key of list) if (key in data) out[key] = structuredClone(data[key]);
      return out;
    },
    async set(values) {
      await Promise.resolve();
      Object.assign(data, structuredClone(values));
    }
  };
}

function createEvent() {
  const listeners = [];
  return { listeners, addListener: fn => listeners.push(fn), emit: (...args) => listeners.map(fn => fn(...args)) };
}

function createFakeBrowser({ sync = {}, local = {}, tabs = [], groups = [], permissions = [], activeTabId } = {}) {
  const nextTabId = { value: Math.max(0, ...tabs.map(t => t.id)) + 1 };
  const state = {
    tabs: tabs.map((t, i) => ({ windowId: 1, pinned: false, groupId: -1, active: false, title: "", ...t, index: t.index ?? i })),
    groups: groups.map(g => ({ windowId: 1, ...g })),
    permissions: new Set(permissions),
    calls: { move: [], remove: [], create: [], groupMove: [] },
    badge: { text: "" },
    alarms: new Map(),
    notifications: []
  };
  if (activeTabId != null) for (const t of state.tabs) t.active = t.id === activeTabId;

  const reindex = () => state.tabs.forEach((t, i) => { t.index = i; });
  const originOf = o => o.origins || [];

  const browser = {
    storage: { sync: createArea(sync), local: createArea(local) },
    permissions: {
      async contains({ origins }) { return originOf({ origins }).every(o => state.permissions.has(o)); },
      async request({ origins }) { origins.forEach(o => state.permissions.add(o)); return true; },
      async remove({ origins }) { origins.forEach(o => state.permissions.delete(o)); return true; }
    },
    alarms: {
      async getAll() { return [...state.alarms.values()]; },
      async clear(name) { return state.alarms.delete(name); },
      create(name, info) { state.alarms.set(name, { name, ...info }); },
      onAlarm: createEvent()
    },
    browserAction: {
      async setBadgeText({ text }) { state.badge.text = text; },
      async setBadgeBackgroundColor({ color }) { state.badge.color = color; }
    },
    notifications: { create(id, options) { state.notifications.push({ id, options }); } },
    runtime: { onMessage: createEvent(), getURL: p => `moz-extension://fake/${p}` },
    windows: { async getCurrent() { return { id: 1 }; } },
    commands: { onCommand: createEvent() },
    tabs: {
      onCreated: createEvent(),
      onUpdated: createEvent(),
      async query(q = {}) {
        let result = state.tabs;
        if (q.windowId != null) result = result.filter(t => t.windowId === q.windowId);
        if (q.groupId != null) result = result.filter(t => t.groupId === q.groupId);
        if (q.active != null) result = result.filter(t => t.active === q.active);
        return structuredClone(result);
      },
      async move(ids, { index }) {
        const list = Array.isArray(ids) ? ids : [ids];
        state.calls.move.push({ ids: list, index });
        const moving = list.map(id => state.tabs.find(t => t.id === id));
        const rest = state.tabs.filter(t => !moving.includes(t));
        const at = index === -1 ? rest.length : Math.min(index, rest.length);
        state.tabs = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
        reindex();
        return moving.map(t => ({ ...t }));
      },
      async remove(ids) {
        const list = Array.isArray(ids) ? ids : [ids];
        state.calls.remove.push(list);
        state.tabs = state.tabs.filter(t => !list.includes(t.id));
        reindex();
      },
      async create(props) {
        state.calls.create.push(props);
        const tab = { id: nextTabId.value++, windowId: props.windowId ?? 1, pinned: Boolean(props.pinned), groupId: -1, active: false, title: "", url: props.url };
        const at = props.index == null ? state.tabs.length : Math.min(props.index, state.tabs.length);
        state.tabs.splice(at, 0, tab);
        reindex();
        return { ...tab };
      },
      async update(id, props) {
        const tab = state.tabs.find(t => t.id === id);
        if (props.active) for (const t of state.tabs) t.active = t === tab;
        return { ...tab };
      },
      async group({ tabIds, groupId, createProperties }) {
        const id = groupId ?? Math.max(0, ...state.groups.map(g => g.id)) + 1;
        if (groupId == null) state.groups.push({ id, title: "", windowId: createProperties?.windowId ?? 1 });
        for (const t of state.tabs) if (tabIds.includes(t.id)) t.groupId = id;
        return id;
      },
      async ungroup(ids) {
        for (const t of state.tabs) if (ids.includes(t.id)) t.groupId = -1;
      }
    },
    tabGroups: {
      async query({ windowId }) { return structuredClone(state.groups.filter(g => g.windowId === windowId)); },
      async update(id, props) { Object.assign(state.groups.find(g => g.id === id), props); },
      async move(id, { index }) { state.calls.groupMove.push({ id, index }); }
    }
  };

  return { browser, state };
}

function loadBackground(options = {}) {
  const { browser, state } = createFakeBrowser(options);
  const fetchCalls = [];
  const fetchHandler = options.fetch || (async () => ({ ok: true, status: 200, url: "https://example.com/" }));
  const context = vm.createContext({
    browser,
    console,
    URL,
    Date,
    Promise,
    structuredClone,
    setTimeout,
    clearTimeout,
    fetch: async (url, init) => {
      fetchCalls.push(url);
      return fetchHandler(url, init);
    }
  });
  for (const file of BACKGROUND_SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, file), "utf8"), context, { filename: file });
  }
  const plain = value => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
  const call = async expression => plain(await vm.runInContext(expression, context));
  const ready = vm.runInContext("backgroundReady", context);
  const send = async msg => plain(await browser.runtime.onMessage.listeners[0](msg));
  return { browser, state, fetchCalls, call, ready, send, context };
}

module.exports = { createFakeBrowser, loadBackground };
