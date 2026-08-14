const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  // Navigate to the Vite app
  console.log("Navigating to VideoPlayer...");
  await page.goto('http://localhost:5173/video/hnz-gkj-s4-episode-10-sub-indo', { waitUntil: 'networkidle0' });
  
  // Wait for the video or external stream UI to appear
  try {
    await page.waitForFunction(() => document.querySelector('video') || document.querySelector('iframe') || document.querySelector('.player-overlay'), { timeout: 15000 });
  } catch(e) {
    console.log("Timeout waiting for player element");
  }

  // Dump information about the player
  const info = await page.evaluate(() => {
    const wrapper = document.querySelector('.custom-player-wrapper');
    const video = document.querySelector('video');
    const iframe = document.querySelector('iframe');
    const overlay = document.querySelector('.player-overlay');
    const playBtnWrapper = document.querySelector('.player-overlay > div:nth-child(2)'); // The absolute inset-0 center
    const playBtn = document.querySelector('.player-overlay > div:nth-child(2) > div'); // The circle
    
    return {
      wrapper: wrapper ? wrapper.getBoundingClientRect().toJSON() : null,
      video: video ? video.getBoundingClientRect().toJSON() : null,
      iframe: iframe ? iframe.getBoundingClientRect().toJSON() : null,
      overlay: overlay ? overlay.getBoundingClientRect().toJSON() : null,
      playBtnWrapper: playBtnWrapper ? playBtnWrapper.getBoundingClientRect().toJSON() : null,
      playBtn: playBtn ? playBtn.getBoundingClientRect().toJSON() : null,
      streamUrl: video ? video.src : (iframe ? iframe.src : null),
      hasControls: video ? video.controls : null,
      html: wrapper ? wrapper.outerHTML : null
    };
  });

  console.log(JSON.stringify(info, null, 2));

  await browser.close();
})();
