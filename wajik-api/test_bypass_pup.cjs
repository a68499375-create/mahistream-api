const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--host-resolver-rules="MAP v2.samehadaku.how 104.26.6.147"'
    ]
  });

  const page = await browser.newPage();
  try {
    console.log("Fetching Samehadaku...");
    const res = await page.goto('https://v2.samehadaku.how/?s=otonari+tenshi', { waitUntil: 'domcontentloaded', timeout: 15000 });
    console.log("Status:", res.status());
    console.log("Title:", await page.title());
  } catch (e) {
    console.error("Error:", e.message);
  }
  await browser.close();
})();
