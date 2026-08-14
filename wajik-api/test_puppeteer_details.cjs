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
    await page1.goto("https://samehadaku.li/anime/one-piece/", { waitUntil: "domcontentloaded", timeout: 20000 });
    fs.writeFileSync("samehadaku_detail.html", await page1.content());
    console.log("Samehadaku detail done");
  } catch(e) { console.error(e) }

  try {
    const page2 = await browser.newPage();
    await page2.goto("https://samehadaku.li/one-piece-episode-1100/", { waitUntil: "domcontentloaded", timeout: 20000 });
    fs.writeFileSync("samehadaku_episode.html", await page2.content());
    console.log("Samehadaku episode done");
  } catch(e) { console.error(e) }

  await browser.close();
}
run();
