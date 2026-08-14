import getHTML from "./dist/helpers/getHTML.js";

async function run() {
  try {
    const html = await getHTML("https://otakudesu.blog", "/episode/yowayowa-sensei-episode-1-sub-indo/");
    console.log(html.substring(0, 500));
    require('fs').writeFileSync('test_puppeteer.html', html);
  } catch (e) {
    console.error(e);
  }
}
run();
