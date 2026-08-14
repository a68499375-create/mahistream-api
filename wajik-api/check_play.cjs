const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  
  console.log("Navigating to VideoPlayer...");
  await page.goto('http://localhost:5173/video/hnz-gkj-s4-episode-10-sub-indo', { waitUntil: 'networkidle0' });
  
  try {
    await page.waitForFunction(() => document.querySelector('video') || document.querySelector('iframe') || document.querySelector('.player-overlay'), { timeout: 15000 });
  } catch(e) {
    console.log("Timeout waiting for player element");
  }

  // Click the center of the video wrapper to trigger play
  console.log("Clicking the video to play...");
  try {
    const wrapper = await page.$('.custom-player-wrapper');
    if (wrapper) {
      await wrapper.click();
    }
  } catch (e) {
    console.log("Click failed:", e);
  }

  // Wait a bit to see if it plays
  await new Promise(r => setTimeout(r, 3000));

  const info = await page.evaluate(() => {
    const video = document.querySelector('video');
    return {
      streamUrl: video ? video.src : null,
      paused: video ? video.paused : null,
      currentTime: video ? video.currentTime : null,
      error: video && video.error ? video.error.message : null,
      readyState: video ? video.readyState : null,
      networkState: video ? video.networkState : null
    };
  });

  console.log("VIDEO STATE:", JSON.stringify(info, null, 2));

  await browser.close();
})();
