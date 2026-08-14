import fs from "fs";
async function downloadJs() {
    console.log("=== Downloading Kuramanime JS Files ===");
    try {
        const urls = [
            "https://v18.kuramanime.ing/assets/js/wzl3ClXO8shDECR.js",
            "https://v18.kuramanime.ing/assets/js/leviathan.js"
        ];
        for (const url of urls) {
            console.log("Fetching:", url);
            const res = await fetch(url);
            const text = await res.text();
            const filename = url.split("/").pop();
            fs.writeFileSync(filename, text);
            console.log(`Saved ${filename} (${text.length} bytes)`);
        }
    }
    catch (err) {
        console.error("Download failed:", err);
    }
    process.exit(0);
}
downloadJs();
