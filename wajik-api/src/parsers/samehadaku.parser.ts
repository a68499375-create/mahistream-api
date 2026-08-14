import samehadakuScraper from "../scrapers/samehadaku.scraper.js";
import samehadakuConfig from "../configs/samehadaku.config.js";

const { baseUrl } = samehadakuConfig;

const samehadakuParser = {
  async parseSearch(query: string, page: number = 1): Promise<any[]> {
    const pageUrl = page > 1 ? `/page/${page}/?s=${encodeURIComponent(query)}` : `/?s=${encodeURIComponent(query)}`;
    const document = await samehadakuScraper.scrapeDOM(pageUrl);
    const results: any[] = [];

    const items = document.querySelectorAll("article.bs, article.animpost");
    items.forEach((item) => {
      const a = item.querySelector("a, a.tip");
      const url = a?.getAttribute("href") || "";
      let id = "";
      if (url.includes("/anime/")) {
        id = url.split("/anime/")[1]?.replace(/\/$/, "") || "";
      } else if (url.includes("/episode/")) {
        return;
      }
      if (!id) return;

      const title = item.querySelector("h2, .title, .entry-title")?.text?.trim() || a?.getAttribute("oldtitle") || a?.getAttribute("title") || "";
      const poster = item.querySelector("img")?.getAttribute("src") || "";
      const score = item.querySelector(".score")?.text?.trim() || "N/A";
      const status = item.querySelector(".status")?.text?.trim() || item.querySelector(".epx")?.text?.trim() || "Unknown";
      
      results.push({
        animeId: id,
        title,
        poster,
        status,
        score,
        url,
      });
    });

    return results;
  },

  async parseAnimeDetails(id: string): Promise<any> {
    try {
      const document = await samehadakuScraper.scrapeDOM(`/anime/${id}`);
      
      const title = document.querySelector("h1.entry-title")?.text?.trim() || "";
      const poster = document.querySelector(".infox .thumb img, .thumb img")?.getAttribute("src") || "";
      const synopsis = document.querySelector(".entry-content, .desc")?.text?.trim() || "";
      
      const score = document.querySelector(".ratingValue")?.text?.trim() || "N/A";
      const statusElement = Array.from(document.querySelectorAll(".spe span")).find(s => s.text.includes("Status"));
      const status = statusElement?.text?.replace("Status", "").trim() || "Unknown";

      const episodeList: any[] = [];
      const epItems = document.querySelectorAll(".eplister ul li, .lstepsiode ul li");
      epItems.forEach(el => {
        const a = el.querySelector("a");
        if (!a) return;
        const epUrl = a.getAttribute("href") || "";
        const epId = epUrl.split("/").filter(Boolean).pop() || "";
        const epTitle = el.querySelector(".epl-title")?.text?.trim() || el.querySelector(".epsleft a")?.text?.trim() || "";
        const epDate = el.querySelector(".epl-date")?.text?.trim() || el.querySelector(".epsright")?.text?.trim() || "";
        episodeList.push({
          episodeId: epId,
          title: epTitle,
          date: epDate,
          url: epUrl,
        });
      });

      return {
        title,
        poster,
        synopsis: { paragraphList: [synopsis] },
        score,
        status,
        episodeList,
      };
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  async parseEpisodeDetails(id: string): Promise<any> {
    try {
      const document = await samehadakuScraper.scrapeDOM(`/${id}`);
      
      const title = document.querySelector("h1.entry-title")?.text?.trim() || "";
      const iframeSrc = document.querySelector(".player-area iframe")?.getAttribute("src") || "";
      
      const serverList: any[] = [];
      
      // New structure: <select class="mirror"><option value="BASE64">...</option></select>
      const mirrorOptions = document.querySelectorAll(".mirror option");
      mirrorOptions.forEach(opt => {
        const value = opt.getAttribute("value");
        const serverName = opt.text?.trim() || "Unknown";
        if (value && value.length > 10) {
          serverList.push({
            serverId: value,
            title: serverName
          });
        }
      });
      
      // Fallback old structure
      if (serverList.length === 0) {
        const options = document.querySelectorAll(".east_player_option");
        options.forEach(opt => {
          const postId = opt.getAttribute("data-post");
          const nume = opt.getAttribute("data-nume");
          const type = opt.getAttribute("data-type");
          const serverName = opt.text?.trim() || "Unknown";
          
          if (postId && nume && type) {
            serverList.push({
              serverId: `${postId}-${nume}-${type}`,
              title: serverName
            });
          }
        });
      }
      
      return {
        title,
        defaultStreamingUrl: iframeSrc,
        serverList
      };
    } catch (e) {
      console.error(e);
      return null;
    }
  },
  
  async parseStreamUrl(serverId: string): Promise<string> {
    // If it doesn't look like postId-nume-type, it's the new base64 format
    if (!serverId.includes("-")) {
      try {
        const decoded = Buffer.from(serverId, "base64").toString("utf-8");
        const match = decoded.match(/src="([^"]+)"/i) || decoded.match(/src='([^']+)'/i);
        if (match && match[1]) {
          return match[1];
        }
        return "";
      } catch (e) {
        console.error("Base64 decode failed:", e);
      }
    }

    // Fallback old format
    const [postId, nume, type] = serverId.split("-");
    if (!postId || !nume || !type) return "";

    try {
      const browser = await (await import("../helpers/getHTML.js")).getBrowser();
      const page = await browser.newPage();
      await page.goto(`${baseUrl}`, { waitUntil: 'domcontentloaded' });
      
      const html = await page.evaluate(async (p, n, t) => {
        const formData = new FormData();
        formData.append('action', 'player_ajax');
        formData.append('post', p);
        formData.append('nume', n);
        formData.append('type', t);
        
        const res = await fetch('/wp-admin/admin-ajax.php', {
          method: 'POST',
          body: formData
        });
        return await res.text();
      }, postId, nume, type);
      
      await page.close();

      const match = html.match(/src="([^"]+)"/);
      if (match && match[1]) {
        return match[1];
      }
      return "";
    } catch (e) {
      console.error(e);
      return "";
    }
  }
};

export default samehadakuParser;
