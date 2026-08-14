async function testOtakudesu(query) {
  try {
    const res = await fetch(`http://localhost:3001/otakudesu/search/${encodeURIComponent(query)}`);
    const json = await res.json();
    if (json.data && json.data.searchResult && json.data.searchResult.length > 0) {
      console.log(`Otakudesu Query: "${query}" -> Found ${json.data.searchResult.length} results. First: "${json.data.searchResult[0].title}"`);
      return true;
    } else {
      console.log(`Otakudesu Query: "${query}" -> Not found`);
      return false;
    }
  } catch (e) {
    console.error(e);
    return false;
  }
}

async function run() {
  await testOtakudesu("otonari");
  await testOtakudesu("gojo");
  await testOtakudesu("frieren beyond journeys end");
}

run();
