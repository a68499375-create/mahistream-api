import kuramanimeScraper from "./src/scrapers/kuramanime.scraper.js";

async function run() {
  const doc = await kuramanimeScraper.scrapeDOM('/anime/3/boruto-naruto-next-generations');
  const epLists = doc.querySelector("#episodeLists");
  if (epLists) {
    console.log("Found #episodeLists");
    console.log("Links:", epLists.querySelectorAll("a").length);
  } else {
    console.log("No #episodeLists found!");
    // check what it is
    const eps = doc.querySelectorAll("a").filter(a => a.getAttribute("href") && a.getAttribute("href").includes("/episode/"));
    console.log("Found episode links globally:", eps.length);
    if (eps.length > 0) {
      console.log("First:", eps[0].getAttribute("href"));
    }
  }
}
run();
