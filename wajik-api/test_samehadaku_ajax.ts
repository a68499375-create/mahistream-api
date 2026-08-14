import getHTML, { getBrowser } from './src/helpers/getHTML.js';

async function testAjax() {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    
    // Kita jalankan script di dalam page context
    await page.goto('https://v2.samehadaku.how', { waitUntil: 'domcontentloaded' });
    
    const result = await page.evaluate(async () => {
      const formData = new FormData();
      formData.append('action', 'player_ajax');
      formData.append('post', '50695');
      formData.append('nume', '1');
      formData.append('type', 'schtml');
      
      const res = await fetch('/wp-admin/admin-ajax.php', {
        method: 'POST',
        body: formData
      });
      return await res.text();
    });
    
    console.log("AJAX Result:", result);
    await browser.close();
  } catch (e) {
    console.error(e);
  }
  process.exit(0);
}

testAjax();
