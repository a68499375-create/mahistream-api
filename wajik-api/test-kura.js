import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteerExtra.use(StealthPlugin());

(async () => {
  console.log("Launching...");
  try {
    const browser = await puppeteerExtra.launch({
      headless: true,
      args: [
        "--no-sandbox", 
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--single-process"
      ]
    });
    console.log("Browser launched.");
    const page = await browser.newPage();
    console.log("Navigating to base URL...");
    await page.goto("https://v18.kuramanime.ing", { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    console.log("Warming check loop...");
    for (let i = 0; i < 20; i++) {
      const title = await page.title();
      console.log(`Attempt ${i}: Title = "${title}"`);
      if (title && !title.includes("Just a moment") && !title.includes("Attention Required")) {
        console.log("Cloudflare solved successfully!");
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log("Navigating to target search URL...");
    await page.goto("https://v18.kuramanime.ing/anime?search=naruto&order_by=latest&page=1", { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log("Target page title:", await page.title());
    const content = await page.content();
    console.log("HTML Content length:", content.length);
    console.log("Sample text:", content.substring(0, 1000));

    await browser.close();
  } catch (e) {
    console.error("Test failed:", e);
  }
})();
