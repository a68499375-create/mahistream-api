import getHTML from "../helpers/getHTML.js";
import getHTMLViaFlareSolverr from "../helpers/getHTMLViaFlareSolverr.js";
import errorinCuy from "../helpers/errorinCuy.js";

const BASE_URL = "https://nekopoi.care";

// Wait selectors are intentionally permissive: nekopoi.care has shipped at
// least three layouts (legacy `.eropost`/`.result`/`.eroinfo`, intermediate
// `.nk-post-card`/`.nk-search-item`, and a newer card-based theme). Listing
// every plausible candidate means Puppeteer resolves as soon as any of them
// renders, so we don't pay the 15-second waitForSelector timeout when the
// site changes class names again.
const LATEST_WAIT = [
  ".eropost",
  ".result",
  ".nk-post-card",
  ".post-card",
  "article.post",
  ".listupd .bs",
  ".main-info"
].join(", ");

const SEARCH_WAIT = [
  ".eropost",
  ".result",
  ".nk-search-item",
  ".nk-search-results",
  ".nk-post-card",
  ".post-card",
  "article.post",
  ".search-results"
].join(", ");

const DETAIL_WAIT = [
  ".eroinfo",
  ".eroimg",
  ".liner",
  ".nk-post-body",
  "#nk-player",
  "#player",
  ".embed-player",
  ".download",
  ".dlbod",
  "#nk-player-tabs",
  ".nk-player-frame",
  ".nk-player-tab"
].join(", ");

const nekopoiScraper = {
  async getLatest(page = 1) {
    try {
      const url = page > 1 ? `${BASE_URL}/page/${page}` : BASE_URL;
      // Use Puppeteer for nekopoi (more reliable than FlareSolverr for this site)
      const html = await getHTML(BASE_URL, url, undefined, false, LATEST_WAIT);
      console.log(`[NEKOPOI SCRAPER] getLatest page=${page} html.length=${html.length}`);
      return html;
    } catch (e) {
      console.error("Nekopoi Scraper Error:", e);
      throw errorinCuy(500, "Gagal mengambil data dari Nekopoi");
    }
  },

  async getSearch(query: string, page = 1) {
    try {
      const url = `${BASE_URL}/search/${encodeURIComponent(query)}/page/${page}`;
      const html = await getHTML(BASE_URL, url, undefined, false, SEARCH_WAIT);
      console.log(`[NEKOPOI SCRAPER] getSearch q="${query}" page=${page} html.length=${html.length}`);
      return html;
    } catch (e) {
      console.error("Nekopoi Search Error:", e);
      throw errorinCuy(500, "Gagal mencari data di Nekopoi");
    }
  },

  async getDetail(urlPath: string) {
    try {
      const url = urlPath.startsWith("http") ? urlPath : (urlPath.startsWith("/") ? `${BASE_URL}${urlPath}` : `${BASE_URL}/${urlPath}`);
      // A referer is required: without it Nekopoi runs an anti-bot script that wipes the page to about:blank.
      const html = await getHTML(BASE_URL, url, `${BASE_URL}/`, false, DETAIL_WAIT);
      console.log(`[NEKOPOI SCRAPER] getDetail url=${url} html.length=${html.length}`);
      return html;
    } catch (e) {
      console.error("Nekopoi Detail Error:", e);
      throw errorinCuy(500, "Gagal mengambil detail dari Nekopoi");
    }
  },

  // Category listing: /category/<slug>/page/<n>. Layoutnya identik dengan
  // homepage latest, jadi parser parseLatest bisa langsung dipakai. Slug
  // utama: "hentai", "3d-hentai", "jav", "jav-cosplay", "2d-animation".
  // Category listing. Slug utama: "hentai", "3d-hentai", "jav",
  // "jav-cosplay", "2d-animation".
  //
  // CATATAN: Slug "hentai" SPESIFIK punya bug di sisi origin nekopoi.care —
  // URL `/category/hentai/` return 302 redirect ke `http://127.0.0.1` yang
  // membuat Puppeteer crash (ERR_EMPTY_RESPONSE). Slug lain (3d-hentai, jav,
  // dst.) bekerja normal. Untuk slug "hentai", kita coba URL alternatif
  // yang return 200 OK: `/hentai/` (tanpa prefix `category/`), lalu
  // `/tag/hentai/` sebagai cadangan.
  async getCategory(slug: string, page = 1) {
    try {
      const cleanSlug = String(slug || "hentai").replace(/^\/+|\/+$/g, "");

      // Alternative URLs khusus untuk slug bermasalah "hentai".
      const alternativeUrls = cleanSlug === "hentai"
        ? [
            page > 1 ? `${BASE_URL}/hentai/page/${page}/` : `${BASE_URL}/hentai/`,
            page > 1 ? `${BASE_URL}/tag/hentai/page/${page}/` : `${BASE_URL}/tag/hentai/`,
            page > 1 ? `${BASE_URL}/category/${cleanSlug}/page/${page}/` : `${BASE_URL}/category/${cleanSlug}/`,
          ]
        : [
            page > 1 ? `${BASE_URL}/category/${cleanSlug}/page/${page}/` : `${BASE_URL}/category/${cleanSlug}/`,
          ];

      let lastErr: any;
      for (const url of alternativeUrls) {
        try {
          const html = await getHTML(BASE_URL, url, `${BASE_URL}/`, false, LATEST_WAIT);
          if (html && html.length > 1000) {
            console.log(`[NEKOPOI SCRAPER] getCategory slug="${cleanSlug}" page=${page} url=${url} html.length=${html.length}`);
            return html;
          }
        } catch (e) {
          lastErr = e;
          console.warn(`[NEKOPOI SCRAPER] getCategory url=${url} failed, trying next`);
        }
      }
      throw lastErr || new Error("All category URLs failed");
    } catch (e) {
      console.error("Nekopoi Category Error:", e);
      throw errorinCuy(500, "Gagal mengambil kategori Nekopoi");
    }
  },

  // Index page: /hentai-list/, /jav-list/, /genre-list/ — daftar A-Z atau
  // genre. Layout di nekopoi.care untuk halaman ini tidak punya selector
  // yang sama dengan homepage, jadi kita biarkan parser menanganinya.
  async getIndex(path: string) {
    try {
      const cleanPath = String(path || "").replace(/^\/+|\/+$/g, "");
      const url = `${BASE_URL}/${cleanPath}/`;
      // Use more specific selector and shorter timeout for index pages
      const html = await getHTML(BASE_URL, url, `${BASE_URL}/`, false, "a[href*='/hentai'], a[href*='/jav'], a[href*='/anime'], .list-group, .genre-list, .index-list, body");
      console.log(`[NEKOPOI SCRAPER] getIndex path="${cleanPath}" html.length=${html.length}`);
      return html;
    } catch (e) {
      console.error("Nekopoi Index Error:", e);
      throw errorinCuy(500, "Gagal mengambil index Nekopoi");
    }
  }
};

export default nekopoiScraper;
