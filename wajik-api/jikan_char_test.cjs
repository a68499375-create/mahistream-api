async function testJikanSearch(query) {
  try {
    console.log(`\nTesting query: "${query}"`);
    
    // Test 1: Direct Anime Search
    const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`);
    const data = await res.json();
    if (data.data && data.data.length > 0) {
      console.log(`  [Anime Endpoint] Found: "${data.data[0].title}"`);
      return; // If found, we're good
    }
    
    // Test 2: Character Search Fallback
    console.log(`  [Anime Endpoint] No results. Trying Character endpoint...`);
    const charRes = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(query)}&limit=1`);
    const charData = await charRes.json();
    
    if (charData.data && charData.data.length > 0) {
      const charId = charData.data[0].mal_id;
      console.log(`  [Character Endpoint] Found Character: "${charData.data[0].name}" (ID: ${charId})`);
      
      // Fetch anime for this character
      const animeRes = await fetch(`https://api.jikan.moe/v4/characters/${charId}/anime`);
      const animeData = await animeRes.json();
      if (animeData.data && animeData.data.length > 0) {
        // Just grab the first anime they appear in (usually the main one, but we might want to sort by popularity)
        // Wait, Jikan character/anime returns an array. Let's just pick the first one's title
        console.log(`  [Character -> Anime] Found Anime: "${animeData.data[0].anime.title}"`);
      }
    } else {
      console.log(`  [Character Endpoint] No results either.`);
    }

  } catch (e) {
    console.error("Error:", e);
  }
}

async function run() {
  await testJikanSearch("attack on titan"); // lowercase english
  await testJikanSearch("gojo satoru"); // character full name
  await testJikanSearch("gojo"); // character short name
  await testJikanSearch("luffy"); // character name
  await testJikanSearch("miku nakano"); // character name
}

run();
