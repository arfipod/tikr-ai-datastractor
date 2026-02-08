/* ── tikr_scraper.js ── auto-scrape engine ─────────────────── */
(() => {
  if (window.__tikrScraper) return;

  /* ═══════════════════ constants ═══════════════════ */

  const JOBS = {
    incomeStatement : { section: "financials", tab: "is",   label: "Income Statement" },
    balanceSheet    : { section: "financials", tab: "bs",   label: "Balance Sheet" },
    cashFlow        : { section: "financials", tab: "cf",   label: "Cash Flow" },
    ratios          : { section: "financials", tab: "r",    label: "Ratios" },
    segments        : { section: "financials", tab: "seg",  label: "Segments" },
    multiples       : { section: "multiples",  tab: "multi",  label: "Valuation Multiples" },
    analystTargets  : { section: "multiples",  tab: "street", label: "Analyst Price Targets" },
    competitors     : { section: "multiples",  tab: "comp",   label: "Competitors" },
    estimates       : { section: "estimates",  tab: "est",  label: "Consensus Estimates" },
    guidance        : { section: "estimates",  tab: "mgmt", label: "Management Guidance" },
    earningsReview  : { section: "estimates",  tab: "er",   label: "Earnings Review" },
    beatsMisses     : { section: "estimates",  tab: "bm",   label: "Beats & Misses" },
    estBreakdown    : { section: "estimates",  tab: "eb",   label: "Estimates Breakdown" },
  };

  /* ═══════════════════ helpers ═══════════════════ */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* [|] character class is immune to backslash-doubling during copy-paste */
  const esc   = (s) => (s ?? "").replace(/[|]/g, "\\\\|");
  const norm  = (s) => esc((s ?? "").replace(/\\s+/g, " ").trim());

  function relay(msg) {
    chrome.runtime.sendMessage(msg).catch(() => {});
  }

  function toast(text) {
    let t = document.getElementById("__tikr_toast");
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
    setTimeout(() => t.remove(), 2500);
  }

  function getIds() {
    const u = new URL(location.href);
    return {
      cid: u.searchParams.get("cid") || "",
      tid: u.searchParams.get("tid") || "",
      ref: u.searchParams.get("ref") || "vx95f7",
    };
  }

  /**
   * Parse company name, ticker, price from <title>.
   *
   * Title formats seen:
   *   "US$278.12 Apple Inc. (AAPL) - Terminal TIKR"
   *   "HK$35.18 Xiaomi Corporation (1810) - Terminal TIKR"
   */
  function getMeta() {
    const t = document.title;

    const close = t.lastIndexOf(")");
    const open  = close > 0 ? t.lastIndexOf("(", close) : -1;
    const ticker = (open > 0 && close > open) ? t.substring(open + 1, close) : "";

    const nameStart = ticker ? t.indexOf(" ") + 1 : 0;
    const price = nameStart > 1 ? t.substring(0, nameStart).trim() : "";

    const nameEnd = open > 0 ? open : t.length;
    const name = t.substring(nameStart, nameEnd).trim();

    return { ticker, name, price };
  }

  function buildPath(job, ids) {
    return "/stock/" + job.section +
      "?cid=" + ids.cid +
      "&tid=" + ids.tid +
      "&tab=" + job.tab +
      "&ref=" + ids.ref;
  }

  /* ═══════════════════ navigation ═══════════════════ */

  async function navigateTo(path) {
    const target = location.origin + path;
    if (location.href === target) return;

    const router =
      document.querySelector("#app")?.__vue_app__?.config?.globalProperties?.$router ??
      document.querySelector("#app")?.__vue__?.$router;

    if (router) {
      try { await router.push(path); } catch (_) { location.href = target; }
    } else {
      location.href = target;
    }

    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      if (location.href === target) break;
      await sleep(150);
    }
  }

  /* ═══════════════════ period selector ═══════════════════ */

  async function setPeriod(period) {
    const isQ = period === "quarterly";
    const wanted = isQ
      ? (txt) => txt === "trimestral" || txt === "quarterly"
      : (txt) => txt === "anual" || txt === "annual";

    const btn = [...document.querySelectorAll("button")].find((b) =>
      wanted(b.innerText.trim().toLowerCase())
    );
    if (!btn) return;
    if (btn.classList.contains("primaryAction") || btn.classList.contains("v-btn--active")) return;

    btn.click();
    await sleep(1800);
  }

  /* ═══════════════════ dataset selector (for Segments) ═══════════════════ */

  async function setDatasetMorningstar() {
    const datasetSelect = document.querySelector(".select-set");
    if (!datasetSelect) return;

    const current = datasetSelect.querySelector(".v-select__selection")?.innerText?.trim() || "";
    if (current === "Morningstar") return;

    const slot = datasetSelect.querySelector(".v-input__slot");
    if (!slot) return;
    slot.click();
    await sleep(400);

    const items = document.querySelectorAll(".v-list-item__title");
    const ms = [...items].find((i) => i.innerText.trim() === "Morningstar");
    if (ms) {
      ms.click();
      await sleep(2000);
    }
  }

  /* ═══════════════════ table extraction ═══════════════════ */

  async function waitForTable(timeout) {
    timeout = timeout || 20000;
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const tables = [...document.querySelectorAll("table")];
      let best = null, bestR = 0;
      for (let i = 0; i < tables.length; i++) {
        const r = tables[i].querySelectorAll("tr").length;
        if (r > bestR) { bestR = r; best = tables[i]; }
      }
      if (best && bestR > 2) return best;
      await sleep(300);
    }
    return null;
  }

  function tableToMarkdown(table) {
    const rows = [];
    const trs = table.querySelectorAll("tr");
    for (let i = 0; i < trs.length; i++) {
      const cells = [...trs[i].querySelectorAll("th,td")].map((c) => norm(c.innerText));
      if (cells.length && cells.some((c) => c !== "")) rows.push(cells);
    }
    if (!rows.length) return "";

    const w   = Math.max(...rows.map((r) => r.length));
    const pad = (r) => r.concat(Array(w - r.length).fill(""));
    const hdr  = pad(rows[0]);
    const sep  = hdr.map(() => "---");
    const body = rows.slice(1).map(pad);
    return [hdr, sep, ...body].map((r) =>
      "| " + r.join(" | ") + " |"
    ).join("\\n");
  }

  function scrapeAllTablesOnPage() {
    const tables = [...document.querySelectorAll("table")];
    if (!tables.length) return "";
    return tables.map(tableToMarkdown).filter(Boolean).join("\\n\\n");
  }

  /* ═══════════════════ main runner ═══════════════════ */

  async function run(jobKeys, period) {
    const ids   = getIds();
    const meta  = getMeta();
    const total = jobKeys.length;
    let done    = 0;

    const chunks = [];
    chunks.push("# " + meta.ticker + " \\u2013 " + meta.name);
    chunks.push("Price: " + meta.price + "  |  Extracted: " + new Date().toISOString());
    chunks.push("Period: " + period + "  |  Sections: " + total);
    chunks.push("---\\n");

    for (let k = 0; k < jobKeys.length; k++) {
      const key = jobKeys[k];
      const job = JOBS[key];
      if (!job) continue;

      done++;
      relay({ type: "SCRAPE_PROGRESS", done: done, total: total, current: job.label });
      toast("(" + done + "/" + total + ") " + job.label + "\\u2026");

      const path = buildPath(job, ids);
      await navigateTo(path);
      await sleep(1500);

      if (job.tab === "seg") {
        await setDatasetMorningstar();
      }

      let table = await waitForTable();
      if (!table) {
        chunks.push("## " + job.label + "\\n\\n_No data available._\\n");
        continue;
      }

      if (job.section === "financials" || job.section === "estimates") {
        await setPeriod(period);
        await sleep(500);
        await waitForTable();
      }

      const md = scrapeAllTablesOnPage();
      chunks.push("## " + job.label + "\\n\\n" + md + "\\n");
    }

    const fullText = chunks.join("\\n");

    relay({ type: "SCRAPE_DONE", text: fullText, meta: meta });
    toast("\\u2705 All done!");

    try { await navigator.clipboard.writeText(fullText); } catch (_) {}
  }

  /* ═══════════════════ expose ═══════════════════ */

  window.__tikrScraper = { run: run, JOBS: JOBS };
})();