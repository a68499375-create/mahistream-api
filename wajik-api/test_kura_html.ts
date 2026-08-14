import kuramanimeScraper from "./src/scrapers/kuramanime.scraper.js";

async function run() {
  const doc = await kuramanimeScraper.scrapeDOM('/anime/3/boruto-naruto-next-generations');
  const epLists = doc.querySelector("#episodeLists");
  if (epLists) {
    console.log("Buttons:", epLists.querySelectorAll("button").length);
    console.log("a tags inside #episodeLists:", epLists.querySelectorAll("a").length);
    const firstBtn = epLists.querySelectorAll("button")[0];
    if (firstBtn) console.log("First button HTML:", firstBtn.innerHTML);
    const a = epLists.querySelectorAll("a")[0];
    if (a) console.log("First a HTML:", a.innerHTML);
    const firstLink = epLists.querySelector("a.btn-play");
    if (firstLink) console.log("btn-play HTML:", firstLink.innerHTML);
  }
}
run();
