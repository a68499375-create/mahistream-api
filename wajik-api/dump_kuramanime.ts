import getHTML from './src/helpers/getHTML.js';
import fs from 'fs';

async function test() {
  try {
    const html = await getHTML('https://kuramanime.pro', '/anime?search=otonari+tenshi');
    fs.writeFileSync('dump_kuramanime_search.html', html);
    console.log("Dumped to dump_kuramanime_search.html");
  } catch (e) {
    console.error("Error:", e);
  }
  process.exit(0);
}

test();
