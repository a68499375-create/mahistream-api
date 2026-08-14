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
      '--host-resolver-rules="MAP v18.kuramanime.ing 104.21.84.148,MAP *.kuramanime.ing 104.21.84.148"'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    
    page.on('response', response => {
      const url = response.url();
      if (url.includes('search') || url.includes('api') || url.includes('misc') || url.includes('json')) {
        console.log("Response URL:", url, response.status());
      }
    });

    console.log("Navigating...");
    await page.goto('https://v18.kuramanime.ing/anime?search=otonari+tenshi', { waitUntil: 'networkidle0' });
    
    // Type into the search bar to trigger quick search
    await page.click('#search-input');
    await page.type('#search-input', 'otonari tenshi');
    await new Promise(r => setTimeout(r, 2000));
    
    console.log("Taking screenshot...");
    await page.screenshot({ path: 'kuramanime_search.png', fullPage: true });
    
  } catch (e) {
    console.error("Error:", e);
  } finally {
    await browser.close();
  }
}

test();
