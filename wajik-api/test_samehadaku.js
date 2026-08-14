import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

// ===== TEST 1: Kuramanime search =====
console.log("=== Testing Kuramanime ===");
try {
  await page.goto('https://v8.kuramanime.tel/anime?search=otonari+tenshi', { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForFunction('document.body.innerText.length > 200', { timeout: 15000 }).catch(() => {});

  const kuraResults = await page.evaluate(() => {
    // Try common selectors
    const cards = document.querySelectorAll('.product__item, .anime-card, .col-lg-3, .col-md-4, .col-6');
    return Array.from(cards).slice(0, 5).map(el => ({
      title: el.querySelector('h5, h4, h3, .product__item__text a, a')?.textContent?.trim()?.substring(0, 80),
      url: el.querySelector('a')?.getAttribute('href')
    }));
  });
  console.log("Kuramanime results:", JSON.stringify(kuraResults, null, 2));
  console.log("Page title:", await page.title());
} catch (e) {
  console.error("Kuramanime error:", e.message);
}

// ===== TEST 2: Try multiple Samehadaku domains =====
const sameDomains = [
  'https://samehadaku.mba',
  'https://samehadaku.email', 
  'https://v1.samehadaku.how',
];

for (const domain of sameDomains) {
  console.log(`\n=== Testing ${domain} ===`);
  try {
    const page2 = await browser.newPage();
    await page2.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page2.goto(`${domain}/?s=otonari`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page2.waitForFunction('document.body.innerText.length > 100', { timeout: 8000 }).catch(() => {});
    console.log("Title:", await page2.title());
    console.log("URL:", page2.url());
    const bodyLen = await page2.evaluate(() => document.body.innerText.length);
    console.log("Body length:", bodyLen);
    const h2s = await page2.evaluate(() => Array.from(document.querySelectorAll('h2')).slice(0, 5).map(h => h.textContent?.trim()));
    console.log("H2s:", h2s);
    await page2.close();
  } catch (e) {
    console.error(`${domain} error:`, e.message);
  }
}

await browser.close();
