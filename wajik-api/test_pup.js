import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

(async () => {
  console.log("Launching...");
  try {
    const browser = await puppeteer.launch({ 
      headless: true,
      args: [
        '--enable-async-dns',
        '--enable-features=async-dns',
        // This is a known way to force DoH in Chrome/Puppeteer
        '--dns-server=1.1.1.1,8.8.8.8' // Also simple DNS change
      ]
    });
    console.log("Browser launched.");
    const page = await browser.newPage();
    console.log("Navigating...");
    await page.goto("https://kuramanime.vip/anime?order_by=latest&page=1&search=otonari", { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log("Page loaded.");
    await page.waitForFunction('document.body.innerText.length > 500', { timeout: 15000 }).catch(() => {});
    const html = await page.content();
    console.log("HTML length:", html.length);
    await browser.close();
  } catch (e) {
    console.error(e);
  }
})();
