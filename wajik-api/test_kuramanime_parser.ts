import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

async function test() {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-web-security",
      '--host-resolver-rules="MAP v18.kuramanime.ing 104.21.84.148, MAP *.kuramanime.ing 104.21.84.148"'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    
    console.log("Navigating...");
    await page.goto('https://v18.kuramanime.ing/anime?order_by=ascending&search=otonari+tenshi&page=1', { waitUntil: 'networkidle2' });
    
    console.log("Taking screenshot...");
    await page.screenshot({ path: 'kuramanime_search.png', fullPage: true });
    
    console.log("Done. Title:", await page.title());
  } catch (e) {
    console.error("Error:", e);
  } finally {
    await browser.close();
  }
}

test();
