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
      '--host-resolver-rules="MAP v18.kuramanime.ing 104.21.84.148"'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.goto('https://v18.kuramanime.ing/anime?search=otonari+tenshi', { waitUntil: 'domcontentloaded' });
    console.log("Success! Title:", await page.title());
  } catch (e) {
    console.error("Error:", e);
  } finally {
    await browser.close();
  }
}

test();
