import getHTML from './src/helpers/getHTML.js';
import fs from 'fs';

async function test() {
  try {
    const html = await getHTML('https://v2.samehadaku.how', '/otonari-no-tenshi-sama-season-2-episode-11/');
    fs.writeFileSync('dump_samehadaku_ep.html', html);
    console.log("Dumped to dump_samehadaku_ep.html");
  } catch (e) {
    console.error("Error:", e);
  }
  process.exit(0);
}

test();
