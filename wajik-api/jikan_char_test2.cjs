async function testChar(query) {
  try {
    const charRes = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(query)}&limit=1`);
    const charData = await charRes.json();
    
    if (charData.data && charData.data.length > 0) {
      const charId = charData.data[0].mal_id;
      console.log(`Query: "${query}" -> Found Character: "${charData.data[0].name}" (ID: ${charId})`);
      
      const animeRes = await fetch(`https://api.jikan.moe/v4/characters/${charId}/anime`);
      const animeData = await animeRes.json();
      if (animeData.data && animeData.data.length > 0) {
        // Find the anime where the character's role is 'Main', or just the first one
        const mainAnime = animeData.data.find(a => a.role === 'Main') || animeData.data[0];
        console.log(`  -> Anime: "${mainAnime.anime.title}"`);
      }
    } else {
      console.log(`Query: "${query}" -> No character found`);
    }
  } catch (e) {
    console.error("Error:", e);
  }
}

async function run() {
  await testChar("gojo");
  await testChar("luffy");
  await testChar("miku nakano");
  await testChar("frieren");
}

run();
