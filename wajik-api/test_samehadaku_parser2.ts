import samehadakuParser from './src/parsers/samehadaku.parser.js';

async function test() {
  console.log("Testing search...");
  const search = await samehadakuParser.parseSearch('otonari tenshi');
  console.log(search.map(s => s.animeId));

  if (search.length > 0) {
    console.log("Testing details for:", search[0].animeId);
    const details = await samehadakuParser.parseAnimeDetails(search[0].animeId);
    console.log("Title:", details?.title);
    console.log("Episodes:", details?.episodeList?.length);
    if (details?.episodeList?.length > 0) {
      console.log("Testing episode:", details.episodeList[0].episodeId);
      const ep = await samehadakuParser.parseEpisodeDetails(details.episodeList[0].episodeId);
      console.log("Episode Title:", ep?.title);
      console.log("Stream URL:", ep?.defaultStreamingUrl);
    }
  }
  process.exit(0);
}

test();
