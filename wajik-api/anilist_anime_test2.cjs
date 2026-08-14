async function testAnilistAnime(query) {
  const graphqlQuery = `
    query ($search: String) {
      Media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
        title {
          romaji
        }
      }
    }
  `;
  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: graphqlQuery, variables: { search: query } })
    });
    const json = await res.json();
    if (json.data && json.data.Media) {
      console.log(`Anime Query: "${query}" -> "${json.data.Media.title.romaji}"`);
    } else {
      console.log(`Anime Query: "${query}" -> Not found`);
    }
  } catch (e) {
    console.error(e);
  }
}
testAnilistAnime("otonari");
