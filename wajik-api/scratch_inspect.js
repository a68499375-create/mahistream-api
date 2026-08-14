import fs from 'fs';
import * as cheerio from 'cheerio';

async function main() {
  const html = fs.readFileSync('search_results.html', 'utf8');
  const $ = cheerio.load(html);
  
  // Find an anchor link that contains the search result pattern
  const a = $('a[href*="nekopoi-hentai-rewind-2025"]');
  if (a.length > 0) {
    console.log("Found anchor!");
    console.log("Parent HTML:\n", a.parent().html());
    console.log("Parent class:", a.parent().attr('class'));
    console.log("Parent-parent HTML:\n", a.parent().parent().html());
    console.log("Parent-parent class:", a.parent().parent().attr('class'));
    console.log("Parent-parent-parent class:", a.parent().parent().parent().attr('class'));
    console.log("Parent-parent-parent-parent class:", a.parent().parent().parent().parent().attr('class'));
  } else {
    console.log("Anchor not found!");
  }
}
main();
