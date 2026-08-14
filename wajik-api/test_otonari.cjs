async function testOtonari() {
  const query = "otonari";
  
  // 1. AniList Character Search
  const graphqlQuery = `
    query ($search: String) {
      Character(search: $search) {
        name { full }
        media(type: ANIME, sort: POPULARITY_DESC, perPage: 1) {
          nodes { title { romaji } }
        }
      }
    }
  `;
  try {
    const anilistRes = await fetch("https://graphql.anilist.co", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: graphqlQuery, variables: { search: query } })
    });
    const anilistData = await anilistRes.json();
    console.log("AniList Character:", JSON.stringify(anilistData, null, 2));
  } catch (e) {
    console.error("AniList Error", e);
  }

  // 2. Jikan Anime Search
  try {
    const jikanRes = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`);
    const jikanData = await jikanRes.json();
    console.log("Jikan Anime:", JSON.stringify(jikanData, null, 2));
  } catch (e) {
    console.error("Jikan Error", e);
  }
}

testOtonari();
