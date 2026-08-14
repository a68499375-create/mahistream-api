import getHTML from './src/helpers/getHTML.js';
import { parse } from 'node-html-parser';

async function test() {
  try {
    const html = await getHTML('https://v2.samehadaku.how', '/?s=otonari+tenshi');
    const doc = parse(html);
    
    console.log("Title:", doc.querySelector('title')?.text);
    
    const items = doc.querySelectorAll('article.animpost, .post-show, article');
    items.slice(0, 5).forEach(item => {
      const title = item.querySelector('h2, .title, .entry-title')?.text?.trim();
      const url = item.querySelector('a')?.getAttribute('href');
      const img = item.querySelector('img')?.getAttribute('src');
      console.log(title, url, img);
    });

  } catch (e) {
    console.error("Error:", e);
  }
  process.exit(0);
}

test();
