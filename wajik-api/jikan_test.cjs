async function testJikanSearch(query) {
  try {
    const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`);
    const data = await res.json();
    if (data.data && data.data.length > 0) {
      console.log(`Query: "${query}" -> Romaji: "${data.data[0].title}"`);
    } else {
      console.log(`Query: "${query}" -> No results from Jikan`);
    }
  } catch (e) {
    console.error("Error:", e);
  }
}

async function run() {
  await testJikanSearch("Frieren Beyond Journey's End");
  await testJikanSearch("呪術廻戦"); // Jujutsu Kaisen in Japanese
  await testJikanSearch("Kimetsu no Yaiba");
  await testJikanSearch("Attack on Titan");
}

run();
