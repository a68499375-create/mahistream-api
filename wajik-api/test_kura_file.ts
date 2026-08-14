import kuramanimeScraper from "./src/scrapers/kuramanime.scraper.js";
import fs from "fs";

async function run() {
  const doc = await kuramanimeScraper.scrapeDOM('/anime/3/boruto-naruto-next-generations');
  fs.writeFileSync("../kura.html", doc.toString());
  console.log("Written to kura.html");
}
run();
