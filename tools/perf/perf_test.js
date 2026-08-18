/**
 * perf_test.js — Puppeteer-driven React Profiler benchmark + focus verification
 *
 * IMPORTANT: Runs in headless Chromium which lacks GPU/compositor acceleration.
 * Absolute actualDuration values are inflated vs headed Chrome (no GPU rasterization,
 * no off-thread painting). Only the HandRolled vs ReactWindow RELATIVE comparison
 * within the same run is informative. Re-run in headed mode for user-perceived numbers.
 *
 * Methodology:
 *   - React.Profiler wraps the grid in App.tsx and logs `actualDuration` per render.
 *   - Scroll: 1,000px increments every 50ms up to 30,000px (≈600 frames window).
 *   - Focus: click first cell → 40 ArrowDown keystrokes → confirm data-cell-id of active element.
 */

import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  let profilerLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[PROFILER]')) {
      profilerLogs.push(text);
    }
  });

  console.log("Navigating to http://localhost:5173/ ...");
  await page.goto('http://localhost:5173/');
  await page.waitForSelector('button');

  // Seed 10k rows
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const seedBtn = btns.find(b => b.textContent.includes('Seed 10k'));
    if (seedBtn) seedBtn.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  // ─── HandRolledGrid: scroll test ──────────────────────────────────────────
  console.log("Starting HandRolledGrid scroll test...");
  profilerLogs = [];
  await page.evaluate(async () => {
    const container = document.querySelector('main').firstElementChild;
    container.scrollTop = 0;
    let y = 0;
    return new Promise(resolve => {
      const interval = setInterval(() => {
        y += 1000;
        container.scrollTop = y;
        if (y >= 30000) { clearInterval(interval); resolve(); }
      }, 50);
    });
  });
  await new Promise(r => setTimeout(r, 500));

  const hrLogs = profilerLogs.slice();
  const hrDurations = hrLogs.map(l => parseFloat(l.match(/([0-9.]+)ms/)[1]));
  const hrAvg = hrDurations.reduce((a, b) => a + b, 0) / hrDurations.length;
  const hrMin = Math.min(...hrDurations);
  const hrMax = Math.max(...hrDurations);
  console.log(`[HandRolledGrid] Frames: ${hrLogs.length} | Avg: ${hrAvg.toFixed(2)}ms | Min: ${hrMin.toFixed(2)}ms | Max: ${hrMax.toFixed(2)}ms`);

  // ─── ReactWindowGrid: enable + scroll test ────────────────────────────────
  await page.evaluate(() => {
    const cb = document.querySelector('input[type="checkbox"]');
    if (cb && !cb.checked) cb.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  console.log("Starting ReactWindowGrid scroll test...");
  profilerLogs = [];
  await page.evaluate(async () => {
    // react-window manages its own internal scroller; scroll the FixedSizeGrid outer div
    const container = document.querySelector('main').firstElementChild;
    container.scrollTop = 0;
    let y = 0;
    return new Promise(resolve => {
      const interval = setInterval(() => {
        y += 1000;
        container.scrollTop = y;
        if (y >= 30000) { clearInterval(interval); resolve(); }
      }, 50);
    });
  });
  await new Promise(r => setTimeout(r, 500));

  const rwLogs = profilerLogs.slice();
  const rwDurations = rwLogs.map(l => parseFloat(l.match(/([0-9.]+)ms/)[1]));
  const rwAvg = rwDurations.reduce((a, b) => a + b, 0) / rwDurations.length;
  const rwMin = Math.min(...rwDurations);
  const rwMax = Math.max(...rwDurations);
  console.log(`[ReactWindowGrid] Frames: ${rwLogs.length} | Avg: ${rwAvg.toFixed(2)}ms | Min: ${rwMin.toFixed(2)}ms | Max: ${rwMax.toFixed(2)}ms`);

  // ─── HandRolledGrid: focus test ───────────────────────────────────────────
  console.log("Starting HandRolled Focus Test...");
  await page.evaluate(() => {
    const cb = document.querySelector('input[type="checkbox"]');
    if (cb && cb.checked) cb.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // Get the first row/col ids so we can predict the expected target cell after 40 ArrowDown
  const hrExpectedCell = await page.evaluate(() => {
    const { rows, cols } = window.__ZUSTAND_STORE__ ?
      window.__ZUSTAND_STORE__.getState() :
      { rows: null, cols: null };
    // Fallback: read from first rendered cell's data-cell-id
    const firstCell = document.querySelector('[data-cell-id]');
    if (!firstCell) return null;
    const [rowId, colId] = firstCell.getAttribute('data-cell-id').split(':');
    return { firstCellId: `${rowId}:${colId}`, firstRowId: rowId, firstColId: colId };
  });
  console.log("[HandRolledGrid] First cell id:", hrExpectedCell?.firstCellId ?? 'N/A');

  // Reset scroll and click first cell to focus it
  await page.evaluate(() => {
    const container = document.querySelector('main').firstElementChild;
    container.scrollTop = 0;
    const firstCell = document.querySelector('[data-cell-id]');
    if (firstCell) firstCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 200));

  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('ArrowDown');
  }
  await new Promise(r => setTimeout(r, 500));

  const hrFocus = await page.evaluate(() => {
    const container = document.querySelector('main').firstElementChild;
    const ae = document.activeElement;
    return {
      tagName: ae.tagName,
      cellId: ae.getAttribute('data-cell-id') ?? 'none',
      scrollTop: container.scrollTop,
    };
  });
  console.log(`[HandRolledGrid Focus Test] ActiveElement: ${hrFocus.tagName} | data-cell-id: ${hrFocus.cellId} | ScrollTop: ${hrFocus.scrollTop}`);

  // ─── ReactWindowGrid: focus test ──────────────────────────────────────────
  console.log("Starting ReactWindow Focus Test...");
  await page.evaluate(() => {
    const cb = document.querySelector('input[type="checkbox"]');
    if (cb && !cb.checked) cb.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  const rwFirstCell = await page.evaluate(() => {
    const firstCell = document.querySelector('[data-cell-id]');
    return firstCell ? firstCell.getAttribute('data-cell-id') : null;
  });
  console.log("[ReactWindowGrid] First cell id:", rwFirstCell ?? 'N/A');

  await page.evaluate(() => {
    const container = document.querySelector('main').firstElementChild;
    container.scrollTop = 0;
    const firstCell = document.querySelector('[data-cell-id]');
    if (firstCell) firstCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 200));

  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('ArrowDown');
  }
  await new Promise(r => setTimeout(r, 500));

  const rwFocus = await page.evaluate(() => {
    const container = document.querySelector('main').firstElementChild;
    const ae = document.activeElement;
    return {
      tagName: ae.tagName,
      cellId: ae.getAttribute('data-cell-id') ?? 'none',
      scrollTop: container.scrollTop,
    };
  });
  console.log(`[ReactWindowGrid Focus Test] ActiveElement: ${rwFocus.tagName} | data-cell-id: ${rwFocus.cellId} | ScrollTop: ${rwFocus.scrollTop}`);

  await browser.close();
})();
