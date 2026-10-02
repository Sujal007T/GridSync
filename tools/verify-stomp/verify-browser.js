const puppeteer = require('puppeteer');

(async () => {
    console.log("Launching Puppeteer...");
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

    console.log("Opening Tab A...");
    const pageA = await browser.newPage();
    pageA.on('console', msg => console.log('Tab A PAGE LOG:', msg.text()));
    pageA.on('pageerror', err => console.log('Tab A PAGE ERROR:', err.toString()));
    await pageA.goto('http://localhost:5173/');

    console.log("Opening Tab B...");
    const pageB = await browser.newPage();
    pageB.on('console', msg => console.log('Tab B PAGE LOG:', msg.text()));
    pageB.on('pageerror', err => console.log('Tab B PAGE ERROR:', err.toString()));
    await pageB.goto('http://localhost:5173/');

    console.log("Seeding grid on both tabs...");
    await pageA.waitForSelector('button');
    await pageA.click('button'); // First button is [DEV] Seed 10k Rows
    
    await pageB.waitForSelector('button');
    await pageB.click('button');

    // Wait for the grid container to render cells, then select the first one
    const cellSelector = 'main div > div > div > div[data-cell-id]';

    console.log("Waiting for grid to render on Tab A...");
    await pageA.waitForSelector(cellSelector, { timeout: 10000 }).catch(async e => {
        console.error("Tab A failed to find cell:", e.message);
        console.log(await pageA.evaluate(() => document.body.innerHTML));
    });

    console.log("Waiting for grid to render on Tab B...");
    await pageB.waitForSelector(cellSelector, { timeout: 10000 }).catch(async e => {
        console.error("Tab B failed to find cell:", e.message);
    });

    console.log("Tab A: Editing cell to 'Apple'...");
    // Puppeteer double click
    await pageA.click(cellSelector, { clickCount: 2 });
    await pageA.waitForSelector('input');
    await pageA.type('input', 'Apple');
    await pageA.keyboard.press('Enter');

    console.log("Tab B: Waiting for sync...");
    await pageB.waitForFunction((sel) => {
        const el = document.querySelector(sel);
        return el && el.textContent === 'Apple';
    }, {}, cellSelector);
    console.log("✅ Tab B received 'Apple' from Tab A!");

    console.log("Tab B: Editing cell to 'Banana'...");
    await pageB.click(cellSelector, { clickCount: 2 });
    await pageB.waitForSelector('input');
    // Clear input
    await pageB.keyboard.down('Control');
    await pageB.keyboard.press('A');
    await pageB.keyboard.up('Control');
    await pageB.keyboard.press('Backspace');
    // Type new value
    await pageB.type('input', 'Banana');
    await pageB.keyboard.press('Enter');

    console.log("Tab A: Waiting for sync...");
    await pageA.waitForFunction((sel) => {
        const el = document.querySelector(sel);
        return el && el.textContent === 'Banana';
    }, {}, cellSelector);
    console.log("✅ Tab A received 'Banana' from Tab B!");

    console.log("\n🎉 Manual Browser Verification via Puppeteer Successful! Both tabs synced via NGINX load balancer.");
    await browser.close();
})();
