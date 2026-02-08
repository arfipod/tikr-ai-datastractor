/* ── content.js ── pick-mode + message router ──────────────── */
(function () {

  /* ════════════ helpers ════════════ */

  /* [|] uses a character class so backslash-doubling during copy-paste can never break it */
  var esc  = function (s) { return (s == null ? "" : s).replace(/[|]/g, "\\\\|").trim(); };
  var norm = function (s) { return esc((s == null ? "" : s).replace(/\\s+/g, " ").trim()); };

  function tableToMd(table) {
    var rows = [];
    var trs = table.querySelectorAll("tr");
    for (var i = 0; i < trs.length; i++) {
      var cells = Array.from(trs[i].querySelectorAll("th,td")).map(function (c) {
        return norm(c.innerText);
      });
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return "";
    var w = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    var pad = function (r) { return r.concat(Array(w - r.length).fill("")); };
    var hdr  = pad(rows[0]);
    var sep  = hdr.map(function () { return "---"; });
    var body = rows.slice(1).map(pad);
    return [hdr, sep].concat(body).map(function (r) {
      return "| " + r.join(" | ") + " |";
    }).join("\\n");
  }

  function toast(text) {
    var t = document.getElementById("__tikr_toast");
    if (t) t.remove();
    t = document.createElement("div");
    t.id = "__tikr_toast";
    t.textContent = text;
    t.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:999999;" +
      "background:rgba(0,0,0,.85);color:#fff;padding:10px 14px;" +
      "border-radius:10px;font:13px/1.4 system-ui,sans-serif;" +
      "box-shadow:0 6px 18px rgba(0,0,0,.25);";
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }

  /* ════════════ pick mode ════════════ */

  var picking = false, highlighted = null;

  function highlight(el) {
    if (highlighted) highlighted.style.outline = "";
    highlighted = el;
    el.style.outline = "3px solid #00aaff";
  }

  function cleanPick() {
    picking = false;
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onPick, true);
    document.removeEventListener("keydown", onEsc, true);
    if (highlighted) highlighted.style.outline = "";
    highlighted = null;
  }

  function onMove(e) {
    if (!picking) return;
    var t = e.target ? e.target.closest("table") : null;
    if (t) highlight(t);
  }

  function onPick(e) {
    if (!picking) return;
    var t = e.target ? e.target.closest("table") : null;
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    var md = tableToMd(t);
    cleanPick();
    relay({ type: "MD_RESULT", markdown: md });
    navigator.clipboard.writeText(md).then(
      function () { toast("\\u2705 Table copied as Markdown"); },
      function () { toast("\\u26A0 Open side-panel to copy"); }
    );
  }

  function onEsc(e) {
    if (e.key === "Escape" && picking) {
      cleanPick();
      relay({ type: "MD_RESULT", markdown: "" });
      toast("Cancelled");
    }
  }

  function relay(msg) {
    chrome.runtime.sendMessage(msg).catch(function () {});
  }

  /* ════════════ message listener ════════════ */

  if (window.__tikrOnMessage) {
    chrome.runtime.onMessage.removeListener(window.__tikrOnMessage);
  }

  window.__tikrOnMessage = function (msg) {
    if (msg.type === "ENABLE_PICK_MODE") {
      cleanPick();
      picking = true;
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("click", onPick, true);
      document.addEventListener("keydown", onEsc, true);
      toast("Click any table (Esc to cancel)");
    }

    if (msg.type === "SCRAPE_CMD" && window.__tikrScraper) {
      window.__tikrScraper.run(msg.jobs, msg.period);
    }

    return false;
  };

  chrome.runtime.onMessage.addListener(window.__tikrOnMessage);

  /* ════════════ tell background we are ready ════════════ */
  chrome.runtime.sendMessage({ type: "CONTENT_READY" }).catch(function () {});

})();