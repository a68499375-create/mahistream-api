async function testExtraction() {
  console.log("Fetching episode Yowayowa Sensei Ep 1...");
  const res = await fetch("http://localhost:3001/otakudesu/episode/yowayowa-sensei-episode-1-sub-indo");
  const json = await res.json();
  const details = json.data;

  if (details.download && details.download.qualityList) {
    const downloadQualities = details.download.qualityList.filter(q => q.title.toLowerCase().includes("1080p"));
    const downloadQuality = downloadQualities.find(q => q.title.toLowerCase().includes('mp4')) || downloadQualities[0];
    
    if (downloadQuality && downloadQuality.urlList) {
      console.log("Found 1080p quality:", downloadQuality.title);
      const pdrain = downloadQuality.urlList.find(u => u.title.toLowerCase().includes('pdrain'));
      if (pdrain) {
        console.log("Found pdrain url:", pdrain.url);
        // try redirect
        const redirectRes = await fetch(`http://localhost:3001/otakudesu/redirect-proxy?url=${encodeURIComponent(pdrain.url)}`);
        const redirectJson = await redirectRes.json();
        console.log("Redirect result:", redirectJson);
        const finalUrl = redirectJson.data?.url;
        console.log("Final URL:", finalUrl);
        const pdMatch = finalUrl?.match(/pixeldrain\.com\/u\/([a-zA-Z0-9_-]+)/);
        if (pdMatch && pdMatch[1]) {
          console.log(`Direct Stream URL: https://pixeldrain.com/api/file/${pdMatch[1]}`);
        } else {
          console.log("Failed to match pixeldrain API URL");
        }
      } else {
        console.log("No pdrain found");
      }
    }
  } else {
    console.log("No download section");
  }
}

testExtraction();
