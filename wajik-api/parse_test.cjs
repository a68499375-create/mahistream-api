const fs = require('fs');
const { parse } = require('node-html-parser');
const html = fs.readFileSync('samehadaku.html', 'utf8');
const doc = parse(html);

// Search results
const results = [];
doc.querySelectorAll('a.tip').forEach(a => {
  const url = a.getAttribute('href');
  const title = a.getAttribute('oldtitle') || a.getAttribute('title') || a.querySelector('h2')?.text;
  const img = a.querySelector('img')?.getAttribute('src');
  results.push({url, title, img});
});

console.log(JSON.stringify(results, null, 2));
