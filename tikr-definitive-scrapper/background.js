/* ── background.js ── service-worker ────────────────────────── */

chrome.action.onClicked.addListener(function (tab) {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

/* Pending commands keyed by tabId */
var pending = {};

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {

  /* ── pick mode ── */
  if (msg.type === "START_PICK") {
    pending[msg.tabId] = { type: "ENABLE_PICK_MODE" };
    injectScripts(msg.tabId);
    return false;
  }

  /* ── full auto-scrape ── */
  if (msg.type === "SCRAPE_START") {
    pending[msg.tabId] = {
      type: "SCRAPE_CMD",
      jobs: msg.jobs,
      period: msg.period
    };
    injectScripts(msg.tabId);
    return false;
  }

  /* ── content script says it is ready ── */
  if (msg.type === "CONTENT_READY" && sender.tab) {
    var tabId = sender.tab.id;
    var cmd = pending[tabId];
    if (cmd) {
      delete pending[tabId];
      chrome.tabs.sendMessage(tabId, cmd);
    }
    return false;
  }

  /* ── relay any result to the side-panel ── */
  if (msg.type === "MD_RESULT" ||
      msg.type === "SCRAPE_PROGRESS" ||
      msg.type === "SCRAPE_DONE") {
    chrome.runtime.sendMessage(msg).catch(function () {});
    return false;
  }

  return false;
});

function injectScripts(tabId) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ["content.js", "tikr_scraper.js"]
  });
}