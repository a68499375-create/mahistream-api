const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
puppeteer.use(StealthPlugin());

async function run() {
  const bypassRules = [
    "MAP otakudesu.blog 104.21.84.148",
    "MAP *.otakudesu.blog 104.21.84.148",
    "MAP otakudesu.best 104.21.84.148",
    "MAP *.otakudesu.best 104.21.84.148",
    "MAP otakudesu.cloud 104.21.84.148",
    "MAP *.otakudesu.cloud 104.21.84.148",
    "EXCLUDE *"
  ].join(",");

  const browser = await puppeteer.launch({ 
    headless: true,
    args: [
      "--no-sandbox", 
      "--disable-setuid-sandbox",
      `--host-resolver-rules=${bypassRules}`
    ]
  });
  
  try {
    const page1 = await browser.newPage();
    await page1.goto("https://samehadaku.li/?s=one+piece", { waitUntil: "domcontentloaded", timeout: 20000 });
    fs.writeFileSync("samehadaku.html", await page1.content());
    console.log("Samehadaku done");
  } catch(e) { console.error(e) }

  try {
    const page2 = await browser.newPage();
    await page2.goto("https://v18.kuramanime.ing/anime", { waitUntil: "domcontentloaded", timeout: 20000 });
    fs.writeFileSync("kuramanime.html", await page2.content());
    console.log("Kuramanime done");
  } catch(e) { console.error(e) }

  await browser.close();
}
run();
