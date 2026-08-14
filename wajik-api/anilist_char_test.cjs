async function testAnilist(query) {
  const graphqlQuery = `
    query ($search: String) {
      Character(search: $search) {
        name {
          full
        }
        media(type: ANIME, sort: POPULARITY_DESC, perPage: 1) {
          nodes {
            title {
              romaji
            }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: graphqlQuery,
        variables: { search: query }
      })
    });
    const json = await res.json();
    if (json.data && json.data.Character) {
      const charName = json.data.Character.name.full;
      const animeTitle = json.data.Character.media.nodes[0]?.title?.romaji;
      console.log(`Query: "${query}" -> Char: "${charName}" -> Anime: "${animeTitle}"`);
    } else {
      console.log(`Query: "${query}" -> Not found`);
    }
  } catch (e) {
    console.error(e);
  }
}

async function run() {
  await testAnilist("gojo");
  await testAnilist("luffy");
  await testAnilist("miku nakano");
  await testAnilist("frieren");
}

run();
