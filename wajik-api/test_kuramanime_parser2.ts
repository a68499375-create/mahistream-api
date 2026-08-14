import kuramanimeParser from './src/parsers/kuramanime.parser.js';

async function test() {
  console.log("Testing search...");
  const search = await kuramanimeParser.parseSearch('naruto');
  console.log(search.map(s => s.animeId));

  if (search.length > 0) {
    console.log("Testing details for:", search[0].animeId);
    const details = await kuramanimeParser.parseAnimeDetails(search[0].animeId);
    console.log("Title:", details?.title);
    console.log("Episodes:", details?.episodeList?.length);
    if (details?.episodeList?.length > 0) {
      console.log("Testing episode:", details.episodeList[0].episodeId);
      const ep = await kuramanimeParser.parseEpisodeDetails(details.episodeList[0].episodeId);
      console.log("Episode Title:", ep?.title);
      console.log("Stream Servers:", ep?.serverList);
      console.log("Default stream:", ep?.defaultStreamingUrl);
    }
  }
  process.exit(0);
}

test();
