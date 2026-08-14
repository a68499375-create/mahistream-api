import fs from "fs";

async function downloadRealJs() {
  console.log("=== Downloading Real Kuramanime JS Files ===");
  try {
    const urls = [
      "https://v18.kuramanime.ing/storage/leviathan.js?v=1448",
      "https://v18.kuramanime.ing/assets/page-js/min/anime-episode.min.js?v=415"
    ];
    for (const url of urls) {
      console.log("Fetching:", url);
      const res = await fetch(url);
      const text = await res.text();
      const filename = url.includes("leviathan") ? "leviathan_real.js" : "anime_episode_real.js";
      fs.writeFileSync(filename, text);
      console.log(`Saved ${filename} (${text.length} bytes)`);
    }
  } catch (err) {
    console.error("Download failed:", err);
  }
  process.exit(0);
}

downloadRealJs();
