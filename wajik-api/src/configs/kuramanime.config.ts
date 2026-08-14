// Domain Kuramanime sering rotasi (v9, v18, dst.). `baseUrl` adalah domain
// utama; `fallbackUrls` dicoba berurutan saat scraper gagal pada domain
// utama. Cara invalidate: bertukar urutannya saat domain utama down.
const kuramanimeConfig: IAnimeConfig & { fallbackUrls: string[] } = {
  baseUrl: "https://v18.kuramanime.ing",
  fallbackUrls: [
    "https://v18.kuramanime.ing",
    "https://v9.kuramanime.work",
    "https://v9.kuramanime.blog",
    "https://kuramanime.com",
  ],
};

export default kuramanimeConfig;
