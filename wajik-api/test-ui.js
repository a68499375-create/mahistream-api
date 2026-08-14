import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173');
  
  // Wait for search bar
  await page.waitForSelector('input[type="text"]');
  await page.type('input[type="text"]', 'naruto');
  
  // Press enter
  await page.keyboard.press('Enter');
  
  // Wait for results
  await page.waitForSelector('.anime-card');
  console.log("Search results loaded.");
  
  // Click first result
  await page.click('.anime-card');
  
  // Wait for video player page
  await page.waitForSelector('.video-player-container');
  console.log("Video player loaded.");
  
  // Wait 5 seconds for alternative sources to resolve
  await new Promise(r => setTimeout(r, 5000));
  
  // Check buttons
  const buttons = await page.$$eval('.video-player-container button', btns => 
    btns.map(b => ({ text: b.innerText, disabled: b.disabled }))
  );
  
  const sources = buttons.filter(b => b.text.toLowerCase().includes('otakudesu') || b.text.toLowerCase().includes('samehadaku') || b.text.toLowerCase().includes('kuramanime'));
  console.log("Source buttons:", sources);
  
  await browser.close();
})();
