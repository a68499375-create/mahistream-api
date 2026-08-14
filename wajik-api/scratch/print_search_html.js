const scraper = require('./dist/scrapers/nekopoi.scraper.js').default;
const fs = require('fs');

async function main() {
  try {
    console.log("Fetching search page...");
    const html = await scraper.getSearch('Hentai', 1);
    console.log("Saving HTML...");
    fs.writeFileSync('scratch/search_page.html', html);
    
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    
    console.log("All div classes on page:");
    const classes = new Set();
    $('div').each((_, el) => {
      const cls = $(el).attr('class');
      if (cls) cls.split(/\s+/).forEach(c => classes.add(c));
    });
    console.log(Array.from(classes).slice(0, 50));
    
    console.log("Searching for links containing /hentai/ or post cards:");
    console.log("Anchor count:", $('a').length);
    $('a').slice(0, 20).each((_, el) => {
      console.log("- href:", $(el).attr('href'), "text:", $(el).text().trim());
    });
  } catch (e) {
    console.error(e);
  }
}
main();
