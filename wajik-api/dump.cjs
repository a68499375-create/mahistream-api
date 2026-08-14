async function dumpHtml() {
  const res = await fetch("https://otakudesu.blog/episode/yowayowa-sensei-episode-1-sub-indo/");
  const text = await res.text();
  const fs = require('fs');
  fs.writeFileSync('test_ep.html', text);
}
dumpHtml();
