import kuramanimeScraper from "../scrapers/kuramanime.scraper.js";
import kuramanimeConfig from "../configs/kuramanime.config.js";
import getHTML from "../helpers/getHTML.js";
import extractStream from "../helpers/extractStream.js";
import { parse } from "node-html-parser";
const { baseUrl } = kuramanimeConfig;
const kuramanimeParser = {
    async parseCustom(path) {
        const document = await kuramanimeScraper.scrapeDOM(path, "", false);
        const results = [];
        const items = document.querySelectorAll("#animeList .product__item");
        items.forEach((item) => {
            const a = item.querySelector("a");
            const url = a?.getAttribute("href") || "";
            let id = "";
            if (url.includes("/anime/")) {
                id = url.split("/anime/")[1]?.replace(/\/$/, "") || "";
            }
            const title = item.querySelector("h5")?.text?.trim() || "";
            const poster = item.querySelector(".product__item__pic")?.getAttribute("data-setbg") || "";
            const epsText = item.querySelector(".ep")?.text?.trim() || "";
            const scoreText = item.querySelector(".view")?.text?.trim() || "";
            if (id && title) {
                results.push({
                    animeId: id,
                    title,
                    poster,
                    status: "Unknown",
                    score: scoreText,
                    url
                });
            }
        });
        return results;
    },
    async parseSearch(query, page = 1) {
        // Kuramanime menyajikan dua mode hasil:
        //   1. Card layout (`order_by=latest` + `search=`): poster lengkap, tapi
        //      kadang kehilangan judul tertentu karena ranking server-side.
        //      Misalnya "Harem Camp" tidak muncul di card mode, padahal ada di
        //      site, sehingga sebelumnya hilang dari hasil app kita.
        //   2. Text layout (`order_by=text`): daftar text-only tanpa poster, tapi
        //      lebih lengkap — semua judul yang cocok muncul.
        //
        // Strategi sekarang: jalankan keduanya paralel, gabung hasilnya. Card jadi
        // sumber poster utama; text jadi pelengkap supaya judul yang tidak masuk
        // card tetap ada (poster kosong, frontend punya placeholder).
        const idFromUrl = (url) => {
            if (!url.includes("/anime/"))
                return "";
            return url.split("/anime/")[1]?.replace(/\/$/, "") || "";
        };
        const results = [];
        const seen = new Set();
        const pushResult = (id, title, poster, score, url) => {
            if (!id || !title)
                return;
            const existing = results.find((r) => r.animeId === id);
            if (existing) {
                // Upgrade poster bila sebelumnya kosong (card mode bisa datang setelah
                // text mode atau sebaliknya).
                if (!existing.poster && poster)
                    existing.poster = poster;
                return;
            }
            if (seen.has(id))
                return;
            seen.add(id);
            results.push({ animeId: id, title, poster, status: "Unknown", score: score || "N/A", url });
        };
        const queryStr = query ? `search=${encodeURIComponent(query)}&` : "";
        const cardPath = query
            ? `/anime?${queryStr}order_by=latest&page=${page}`
            : `/anime?order_by=updated&page=${page}`;
        const textPath = query
            ? `/anime?${queryStr}order_by=text&page=${page}`
            : "";
        const fetchDoc = async (path) => {
            try {
                return await kuramanimeScraper.scrapeDOM(path, "", false);
            }
            catch (e) {
                console.warn(`[kura] scrape failed: ${path}`, e);
                return null;
            }
        };
        // Card mode dulu (poster lengkap, biasanya cocok untuk 99% query).
        // Text mode hanya dipanggil kalau card kosong → kurangi 2× request ke
        // FlareSolverr per variant pencarian, search jadi jauh lebih cepat.
        const cardDoc = await fetchDoc(cardPath);
        if (cardDoc) {
            const cardItems = cardDoc.querySelectorAll("#animeList .product__item");
            cardItems.forEach((item) => {
                const url = item.querySelector("a")?.getAttribute("href") || "";
                const id = idFromUrl(url);
                const title = item.querySelector("h5 a")?.text?.trim() || item.querySelector("h5")?.text?.trim() || "";
                let poster = item.querySelector(".product__item__pic")?.getAttribute("data-setbg") || "";
                if (!poster) {
                    const style = item.querySelector(".product__item__pic")?.getAttribute("style") || "";
                    const match = style.match(/url\(['"]?(.*?)['"]?\)/);
                    if (match && match[1])
                        poster = match[1];
                }
                const scoreSpan = item.querySelector(".ep span");
                pushResult(id, title, poster, scoreSpan ? scoreSpan.text.trim() : "N/A", url);
            });
        }
        // Text mode fallback: hanya jalan kalau card kosong, dan hanya saat ada
        // query (browse latest tidak butuh text mode).
        if (results.length === 0 && textPath) {
            const textDoc = await fetchDoc(textPath);
            if (textDoc) {
                const container = textDoc.querySelector("#animeList") || textDoc;
                const links = container.querySelectorAll('a[href*="/anime/"]');
                links.forEach((a) => {
                    const url = a.getAttribute("href") || "";
                    const id = idFromUrl(url);
                    if (!id || id.includes("/episode") || url.includes("/properties/"))
                        return;
                    const title = a.text?.trim() || a.getAttribute("title")?.trim() || "";
                    if (!title || title.length < 2)
                        return;
                    pushResult(id, title, "", "N/A", url);
                });
            }
        }
        return results;
    },
    // Ambil daftar genre dari halaman Kuramanime. Kuramanime menyajikan
    // halaman /properties/genre yang berisi semua genre sebagai link
    // `/properties/genre/<slug>`. Slug dipakai untuk filter di endpoint
    // /anime?genre[]=<slug>.
    // Ambil daftar genre dari halaman Kuramanime. Halaman /properties/genre
    // berisi semua genre sebagai link `/properties/genre/<slug>`. Karena
    // node-html-parser kadang gagal extract text dari anchor multi-line
    // (text kosong → semua entry di-skip), kita pakai regex langsung
    // terhadap raw HTML. Lebih reliable + zero dependency tambahan.
    async parseGenres() {
        try {
            // Try multiple possible paths for genre page on different domains
            const possiblePaths = [
                "/properties/genre",
                "/genre",
                "/genres",
                "/properties/genre/",
                "/daftar-genre",
                "/kategori",
                "/kategori/genre",
                "/category",
                "/categories",
                "/genre-list",
                "/daftar-genre",
            ];
            let html = "";
            let success = false;
            for (const path of possiblePaths) {
                try {
                    const testHtml = await getHTML(baseUrl, path);
                    if (testHtml && testHtml.length > 1000 && !testHtml.includes("Page not found") && !testHtml.includes("404") && !testHtml.includes("Not Found")) {
                        html = testHtml;
                        success = true;
                        console.log(`[kura] parseGenres found genres at path: ${path}`);
                        break;
                    }
                }
                catch (e) {
                    console.warn(`[kura] parseGenres path ${path} failed:`, e);
                    continue;
                }
            }
            if (!success || !html) {
                console.warn("[kura] parseGenres: all paths failed, returning empty");
                return [];
            }
            const doc = parse(html);
            const out = [];
            const seen = new Set();
            // Regex tangkap <a ...href="...properties/genre/<slug>?..."...>BODY</a>
            const rx = /<a[^>]*href="[^"]*\/properties\/genre\/([a-z0-9-]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
            let m;
            while ((m = rx.exec(html)) !== null) {
                const slug = (m[1] || "").toLowerCase().trim();
                if (!slug || seen.has(slug))
                    continue;
                const rawBody = m[2] || "";
                const text = rawBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
                const title = text || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                seen.add(slug);
                out.push({ slug, title });
            }
            if (out.length === 0) {
                const links = doc.querySelectorAll('a[href*="/properties/genre/"]');
                links.forEach((a) => {
                    const href = a.getAttribute("href") || "";
                    const slugMatch = href.match(/\/properties\/genre\/([a-z0-9-]+)/i);
                    if (!slugMatch || !slugMatch[1])
                        return;
                    const slug = slugMatch[1].toLowerCase();
                    if (seen.has(slug))
                        return;
                    const text = (a.text || "").replace(/\s+/g, " ").trim();
                    const title = text || slug.replace(/-/g, " ");
                    seen.add(slug);
                    out.push({ slug, title });
                });
            }
            return out;
        }
        catch (e) {
            console.error("[kura] parseGenres failed", e);
            return [];
        }
    },
    // Browse berdasarkan filter genre + tahun.
    //   /anime?genre[]=<slug>&year[]=<year>&order_by=<latest|popular>&page=N
    async parseBrowse(opts) {
        const params = new URLSearchParams();
        (opts.genres || []).forEach((g) => params.append("genre[]", g));
        (opts.years || []).forEach((y) => params.append("year[]", y));
        params.set("order_by", opts.orderBy || "latest");
        params.set("page", String(opts.page || 1));
        const path = `/anime?${params.toString()}`;
        try {
            const doc = await kuramanimeScraper.scrapeDOM(path);
            const results = [];
            const seen = new Set();
            const cardItems = doc.querySelectorAll("#animeList .product__item");
            cardItems.forEach((item) => {
                const url = item.querySelector("a")?.getAttribute("href") || "";
                const idMatch = url.match(/\/anime\/([^?#]+?)(?:\/?$)/);
                const id = idMatch && idMatch[1] ? idMatch[1].replace(/\/$/, "") : "";
                const title = item.querySelector("h5 a")?.text?.trim() || item.querySelector("h5")?.text?.trim() || "";
                let poster = item.querySelector(".product__item__pic")?.getAttribute("data-setbg") || "";
                if (!poster) {
                    const style = item.querySelector(".product__item__pic")?.getAttribute("style") || "";
                    const m = style.match(/url\(['"]?(.*?)['"]?\)/);
                    if (m && m[1])
                        poster = m[1];
                }
                const score = item.querySelector(".ep span")?.text?.trim() || "N/A";
                if (!id || !title || seen.has(id))
                    return;
                seen.add(id);
                results.push({ animeId: id, title, poster, score, url });
            });
            return results;
        }
        catch (e) {
            console.error("[kura] parseBrowse failed", e);
            return [];
        }
    },
    async parseSchedule() {
        // Kuramanime menyediakan halaman /schedule dengan poster + jam tayang
        // per hari. Hasil dikelompokkan per nama hari (Senin..Minggu) supaya bisa
        // langsung dipakai oleh halaman Jadwal di frontend.
        //
        // Jam tayang harus persis seperti di Kuramanime, jadi pencarian jam
        // dilakukan dari banyak kandidat (selector spesifik dulu, lalu seluruh
        // teks card). Format dikembalikan apa adanya ("20.30" / "20:30").
        const extractJam = (cardEl) => {
            const candidates = [];
            const sel = [
                ".time", ".ep", "small", ".product__item__text small",
                ".product__item__pic .ep", ".product__item__text .ep",
                "[data-time]", ".jam", ".schedule-time",
                ".product__item__info .time", ".product__item__meta .time",
                ".episode-time", ".release-time", ".air-time"
            ];
            sel.forEach((s) => {
                const el = cardEl.querySelector(s);
                if (el) {
                    const dt = el.getAttribute && el.getAttribute("data-time");
                    if (dt)
                        candidates.push(String(dt));
                    const t = (el.text || "").trim();
                    if (t)
                        candidates.push(t);
                }
            });
            // Fallback: ambil seluruh teks card; sering format jam berada di
            // baris kecil yang tidak punya selector unik.
            candidates.push((cardEl.text || "").slice(0, 400));
            for (const c of candidates) {
                const m = String(c).match(/\b(\d{1,2})[:.](\d{2})\b/);
                if (m)
                    return `${m[1]}:${m[2]}`;
            }
            return "";
        };
        try {
            const document = await kuramanimeScraper.scrapeDOM(`/schedule`);
            const days = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
            const buckets = {};
            days.forEach((d) => { buckets[d] = []; });
            // Layout: setiap blok hari adalah .schedule-item dengan judul hari di
            // header (misal "Senin"), berisi card .product__item.
            const blocks = document.querySelectorAll(".schedule-item, .schedule-day, .col-lg-12, .row.schedule-row, [class*='schedule']");
            blocks.forEach((blk) => {
                const heading = blk.querySelector("h4, h5, .day-name, .schedule-day-title, h3, .day-header")?.text?.trim() || "";
                const dayName = days.find((d) => heading.toLowerCase().includes(d.toLowerCase()));
                if (!dayName)
                    return;
                const cards = blk.querySelectorAll(".product__item, .anime-item, .schedule-card, [class*='product__item']");
                cards.forEach((c) => {
                    const a = c.querySelector("a");
                    const url = a?.getAttribute("href") || "";
                    const id = (url.includes("/anime/") ? url.split("/anime/")[1]?.replace(/\/$/, "") : "") || "";
                    const title = c.querySelector("h5 a")?.text?.trim() || c.querySelector("h5")?.text?.trim() || c.querySelector(".title")?.text?.trim() || "";
                    const poster = c.querySelector(".product__item__pic")?.getAttribute("data-setbg") || c.querySelector("img")?.getAttribute("data-src") || c.querySelector("img")?.getAttribute("src") || "";
                    const jam = extractJam(c);
                    if (id && title) {
                        (buckets[dayName] ||= []).push({ animeId: id, title, poster, jam, url });
                    }
                });
            });
            // Fallback: kalau struktur di atas tidak cocok, ambil semua product__item
            // yang punya parent dengan teks hari di neneknya.
            if (days.every((d) => (buckets[d] || []).length === 0)) {
                const allCards = document.querySelectorAll(".product__item, .anime-item, .schedule-card");
                allCards.forEach((c) => {
                    let parent = c.parentNode;
                    let dayName;
                    for (let i = 0; i < 6 && parent; i++) {
                        const txt = (parent.text || "").slice(0, 200);
                        const found = days.find((d) => txt.includes(d));
                        if (found) {
                            dayName = found;
                            break;
                        }
                        parent = parent.parentNode;
                    }
                    if (!dayName)
                        return;
                    const a = c.querySelector("a");
                    const url = a?.getAttribute("href") || "";
                    const id = (url.includes("/anime/") ? url.split("/anime/")[1]?.replace(/\/$/, "") : "") || "";
                    const title = c.querySelector("h5 a")?.text?.trim() || c.querySelector("h5")?.text?.trim() || c.querySelector(".title")?.text?.trim() || "";
                    const poster = c.querySelector(".product__item__pic")?.getAttribute("data-setbg") || c.querySelector("img")?.getAttribute("data-src") || c.querySelector("img")?.getAttribute("src") || "";
                    const jam = extractJam(c);
                    if (id && title)
                        (buckets[dayName] ||= []).push({ animeId: id, title, poster, jam, url });
                });
            }
            return days.map((title) => ({ title, animeList: buckets[title] || [] }));
        }
        catch (e) {
            console.error("Kuramanime schedule parse failed:", e);
            return [];
        }
    },
    async parseAnimeDetails(id) {
        try {
            const document = await kuramanimeScraper.scrapeDOM(`/anime/${id}`);
            const title = document.querySelector(".anime__details__title h3")?.text?.trim()
                || document.querySelector(".anime__details__title h2")?.text?.trim()
                || document.querySelector(".anime__details__title h4")?.text?.trim()
                || document.querySelector(".anime__details__title")?.text?.trim()?.split("\n")[0]?.trim()
                || document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.replace(/\s*-\s*Kuramanime$/i, "").trim()
                || document.querySelector("title")?.text?.replace(/\s*-\s*Kuramanime$/i, "").trim()
                || "";
            const poster = document.querySelector(".anime__details__pic")?.getAttribute("data-setbg") || "";
            const synopsis = document.querySelector("#anime-synopsis")?.text?.trim() || document.querySelector(".anime__details__text p")?.text?.trim() || "";
            const scoreSpan = document.querySelector(".anime__details__rating span");
            const score = scoreSpan ? scoreSpan.text.trim() : "N/A";
            let status = "Unknown";
            const infoItems = document.querySelectorAll(".anime__details__widget ul li");
            infoItems.forEach(item => {
                if (item.text.includes("Status:")) {
                    status = item.text.replace("Status:", "").trim();
                }
            });
            // Batas atas pagination episode. One Piece ~1100 ep dengan ~100 ep/halaman
            // butuh ~11 halaman; 30 cukup longgar untuk anime panjang lain tanpa risiko
            // runaway request.
            const MAX_PAGES = 30;
            const episodeList = [];
            const seenEpisodeIds = new Set();
            const seenEpisodeNumbers = new Set();
            const unescapeHtml = (raw) => raw
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/&#039;/g, "'");
            // Tambah episode dari sebuah string HTML yang berisi link episode.
            // Dipakai untuk popover pertama dan halaman pagination tambahan.
            const harvestEpisodes = (rawHtml) => {
                if (!rawHtml)
                    return 0;
                const contentDoc = parse(unescapeHtml(rawHtml));
                const epLinks = contentDoc.querySelectorAll("a");
                let added = 0;
                epLinks.forEach(a => {
                    const epUrl = a.getAttribute("href") || "";
                    const epTitle = a.text?.trim() || "";
                    if (epTitle.includes("Terbaru") || epTitle.includes("Terlama"))
                        return;
                    // Format URL bisa absolut maupun relatif:
                    //   /anime/3/boruto-naruto-next-generations/episode/212
                    //   https://v18.kuramanime.ing/anime/.../episode/212?page=2
                    const epIdMatch = epUrl.match(/\/anime\/(.+?\/episode\/\d+)/);
                    if (!epIdMatch || !epIdMatch[1])
                        return;
                    const epId = epIdMatch[1].split("?")[0].split("#")[0];
                    if (!epId || seenEpisodeIds.has(epId))
                        return;
                    // Dedup per nomor episode berbasis URL (lebih reliable daripada teks
                    // link, yang kadang berisi nama arc / kosong).
                    const numFromId = epId.match(/episode\/(\d+)/);
                    const numFromTitle = epTitle.match(/\d+/);
                    const epNumber = (numFromId ? numFromId[1] : (numFromTitle ? numFromTitle[0] : "")) || "";
                    if (epNumber && seenEpisodeNumbers.has(epNumber))
                        return;
                    if (epNumber)
                        seenEpisodeNumbers.add(epNumber);
                    seenEpisodeIds.add(epId);
                    episodeList.push({
                        episodeId: epId,
                        title: epTitle.startsWith("Ep") ? `Episode ${epTitle.replace("Ep", "").trim()}` : epTitle,
                        url: epUrl,
                        date: "Unknown",
                    });
                    added++;
                });
                return added;
            };
            // Sumber utama: popover Bootstrap pada `#episodeLists` (data-content).
            // Markup-nya berisi semua link `<a href=".../episode/N">` untuk halaman
            // tersebut, jauh lebih konsisten daripada card list lain di halaman.
            const episodeListsEl = document.querySelector("#episodeLists");
            const firstPageContent = episodeListsEl?.getAttribute("data-content") || "";
            harvestEpisodes(firstPageContent);
            // Fallback: kalau #episodeLists tidak ada (FlareSolverr return static
            // HTML tanpa JS rendering), scan seluruh dokumen untuk link episode.
            if (episodeList.length === 0) {
                const allLinks = document.querySelectorAll('a[href*="/episode/"]');
                let fallbackHtml = "";
                allLinks.forEach(a => {
                    const href = a.getAttribute("href") || "";
                    const text = a.text?.trim() || "";
                    if (href.includes("/episode/") && !href.includes("properties")) {
                        fallbackHtml += `<a href="${href}">${text || "Episode"}</a>\n`;
                    }
                });
                if (fallbackHtml)
                    harvestEpisodes(fallbackHtml);
            }
            // Untuk anime panjang seperti One Piece (1000+ episode), Kuramanime
            // memecah daftar menjadi beberapa halaman. Strategi:
            // 1. Coba baca nomor halaman dari pagination popover (`a[href*="page="]`).
            // 2. Kalau ditemukan, fetch semua halaman 2..maxPage paralel dengan
            //    budget waktu total 25s (mencegah Conan / One Piece membuat user
            //    nunggu menit-menitan kalau FlareSolverr lambat). Halaman yang
            //    tidak sempat balik akan diisi dari cache pada request berikutnya
            //    karena serverCache lru-cache support stale-while-revalidate.
            // 3. Kalau tidak, fallback ke probing sekuensial dengan budget yang sama.
            const PAGE_BUDGET_MS = 25000;
            const harvestStart = Date.now();
            const budgetRemaining = () => Math.max(0, PAGE_BUDGET_MS - (Date.now() - harvestStart));
            try {
                const popoverDoc = parse(unescapeHtml(firstPageContent));
                const pageLinks = popoverDoc.querySelectorAll('a[href*="page="]');
                const foundPages = new Set();
                pageLinks.forEach(a => {
                    const m = (a.getAttribute("href") || "").match(/[?&]page=(\d+)/);
                    if (m && m[1]) {
                        const n = parseInt(m[1], 10);
                        if (n > 1)
                            foundPages.add(n);
                    }
                });
                const fetchPage = async (pageN) => {
                    try {
                        const pagedDoc = await kuramanimeScraper.scrapeDOM(`/anime/${id}?page=${pageN}`);
                        return pagedDoc.querySelector("#episodeLists")?.getAttribute("data-content") || "";
                    }
                    catch {
                        return "";
                    }
                };
                const fetchPageWithBudget = async (pageN) => {
                    const ms = budgetRemaining();
                    if (ms < 1000)
                        return "";
                    return Promise.race([
                        fetchPage(pageN),
                        new Promise((res) => setTimeout(() => res(""), ms)),
                    ]);
                };
                if (foundPages.size > 0) {
                    const maxFromPopover = Math.max(...foundPages);
                    const lastPage = Math.min(maxFromPopover, MAX_PAGES);
                    const pageNums = Array.from({ length: lastPage - 1 }, (_, i) => i + 2);
                    const contents = await Promise.all(pageNums.map(fetchPageWithBudget));
                    contents.forEach(harvestEpisodes);
                }
                else {
                    for (let pageN = 2; pageN <= MAX_PAGES; pageN++) {
                        if (budgetRemaining() < 1000)
                            break;
                        const content = await fetchPageWithBudget(pageN);
                        if (!content)
                            break;
                        const added = harvestEpisodes(content);
                        if (added === 0)
                            break;
                    }
                }
            }
            catch (e) {
                console.warn("Kuramanime episode pagination harvest failed", e);
            }
            // Fallback terakhir untuk anime "specials" / 1-2 episode (mis. "Isekai
            // Meikyuu de Harem wo Specials", "Ookii Onnanoko wa Suki Desu ka?"):
            // halaman detail tidak punya popover #episodeLists yang lengkap, atau
            // popover-nya kosong. Scan langsung halaman utama untuk link
            // `/anime/.../episode/N` apa saja yang ada — biasanya selalu paling
            // tidak satu link "Tonton" atau button play di bagian atas.
            // Tanpa ini, formattedAnime.episodes di frontend default ke
            // anime ID (tanpa /episode/N), sehingga panggilan ke /kuramanime/episode/<id>
            // gagal dan player menampilkan "Maaf, link streaming tidak tersedia".
            if (episodeList.length === 0) {
                const directLinks = document.querySelectorAll('a[href*="/episode/"]');
                directLinks.forEach((a) => {
                    const epUrl = a.getAttribute("href") || "";
                    const epIdMatch = epUrl.match(/\/anime\/(.+?\/episode\/\d+)/);
                    if (!epIdMatch || !epIdMatch[1])
                        return;
                    const epId = epIdMatch[1].split("?")[0].split("#")[0];
                    if (!epId || seenEpisodeIds.has(epId))
                        return;
                    seenEpisodeIds.add(epId);
                    const epTitle = a.text?.trim() || "";
                    episodeList.push({
                        episodeId: epId,
                        title: epTitle.startsWith("Ep") ? `Episode ${epTitle.replace("Ep", "").trim()}` : (epTitle || `Episode ${episodeList.length + 1}`),
                        url: epUrl,
                        date: "Unknown",
                    });
                });
            }
            // Urutkan menaik berdasarkan nomor episode (dari episodeId, bukan title)
            // supaya konsisten lintas halaman.
            const epNum = (ep) => {
                const m = String(ep.episodeId || "").match(/episode\/(\d+)/);
                if (m && m[1])
                    return parseInt(m[1], 10);
                const t = String(ep.title || "").match(/\d+/);
                return t ? parseInt(t[0], 10) : 0;
            };
            episodeList.sort((a, b) => epNum(a) - epNum(b));
            return {
                title,
                poster,
                synopsis: { paragraphList: [synopsis] },
                score,
                status,
                episodeList,
            };
        }
        catch (e) {
            console.error(e);
            return null;
        }
    },
    async parseEpisodeDetails(id) {
        try {
            const cleanId = id.replace(/^\/?(anime\/)?/, "");
            // Tunggu sampai dropdown server dan list download selesai dirender lewat JS
            const document = await kuramanimeScraper.scrapeDOM(`/anime/${cleanId}`, undefined, false, "#changeServer option, #animeDownloadLink a");
            let title = document.querySelector(".anime__details__title h3")?.text?.trim()
                || document.querySelector(".product__page__title h3")?.text?.trim()
                || "";
            // Episode pages don't expose the details title element, fall back to the page metadata.
            if (!title) {
                const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
                const pageTitle = document.querySelector("title")?.text || "";
                title = (ogTitle || pageTitle).replace(/\s*-\s*Kuramanime\s*$/i, "").trim();
            }
            const serverList = [];
            // Kuramanime menaruh server download atau stream di select `#changeServer` atau `#server`
            const servers = document.querySelectorAll("#changeServer option, #server option");
            servers.forEach(opt => {
                const url = opt.getAttribute("value");
                const name = opt.text?.trim();
                if (url && name && !name.includes("Pilih Server")) {
                    // url is like ?server=kuro&type=hd or just "filemoon"
                    let fullServerUrl = "";
                    if (url.startsWith("?") || url.startsWith("/")) {
                        fullServerUrl = `${kuramanimeConfig.baseUrl}/anime/${cleanId}${url}`;
                    }
                    else {
                        fullServerUrl = `${kuramanimeConfig.baseUrl}/anime/${cleanId}?server=${url}`;
                    }
                    serverList.push({
                        serverId: fullServerUrl,
                        title: name
                    });
                }
            });
            // Default stream URL (kalau ada iframe langsung)
            let defaultStreamingUrl = document.querySelector("#player iframe")?.getAttribute("src") || "";
            if (!defaultStreamingUrl) {
                // Coba cari tag source (video mp4 langsung)
                defaultStreamingUrl = document.querySelector("#player source")?.getAttribute("src") || "";
            }
            if (!defaultStreamingUrl) {
                // Coba cari tag video langsung
                defaultStreamingUrl = document.querySelector("#player")?.getAttribute("src") || "";
            }
            // Parse download list. HTML structure di `#animeDownloadLink`:
            //   <h6>MKV 480p (Softsub) — (132.19 MB)</h6>
            //   <a href="..." rel="...">Extra 1</a>
            //   <a href="..." rel="...">kDrive</a>
            //   ...
            //   <h6>MP4 720p (Softsub) — (...)</h6>
            //   <a href="...">...</a>
            // h6 + a tidak nested, jadi kita iterate semua child #animeDownloadLink
            // dan kelompokkan a yang muncul setelah h6 ke quality entry tsb.
            const downloadLinks = [];
            const dlContainer = document.querySelector("#animeDownloadLink");
            if (dlContainer) {
                let current = null;
                const children = dlContainer.querySelectorAll("h6, a");
                children.forEach((el) => {
                    const tag = (el.tagName || el.rawTagName || "").toLowerCase();
                    if (tag === "h6") {
                        const t = (el.text || "").replace(/\s+/g, " ").trim();
                        if (!t)
                            return;
                        // Format: "MKV 480p (Softsub) — (132.19 MB)" atau "MP4 720p — (200 MB)"
                        // Ekstrak resolusi + size untuk display.
                        const qm = t.match(/(\d{3,4}p|4k)/i);
                        const sm = t.match(/\(([^)]*\b(?:MB|GB)\b[^)]*)\)/i);
                        current = {
                            quality: t,
                            resolution: qm ? qm[1].toLowerCase() : "",
                            size: sm ? sm[1] : "",
                            links: [],
                        };
                        downloadLinks.push(current);
                    }
                    else if (tag === "a" && current) {
                        const href = el.getAttribute("href");
                        const host = (el.text || "").replace(/\s+/g, " ").trim() || "Mirror";
                        if (href && href !== "#") {
                            current.links.push({ host, url: href });
                        }
                    }
                });
                // Buang quality yang tidak punya link (jaga-jaga)
                for (let i = downloadLinks.length - 1; i >= 0; i--) {
                    if (!downloadLinks[i].links.length)
                        downloadLinks.splice(i, 1);
                }
            }
            return {
                title,
                defaultStreamingUrl,
                serverList,
                downloadLinks,
            };
        }
        catch (e) {
            console.error(e);
            return null;
        }
    },
    async parseStreamUrl(serverId) {
        try {
            // serverId biasanya full URL embed: https://kuramanime.org/anime/1533/.../episode/1?server=kuramadrive
            // Tapi `kuramanime.org` itu landing AMP yang return 404 untuk path /anime/*.
            // Normalisasi ke host episode aktif (v18.kuramanime.ing dst.) supaya
            // scrapeDOM bisa hit FlareSolverr dengan host yang benar.
            let normalized = serverId;
            try {
                const u = new URL(serverId);
                if (/kuramanime\.org$/i.test(u.hostname)) {
                    u.hostname = "v18.kuramanime.ing";
                }
                normalized = u.toString();
            }
            catch { }
            const document = await kuramanimeScraper.scrapeDOM(normalized, undefined, false, "#player, iframe, .player-frame, #video-player, video source");
            // 1) Player Kuramadrive: <video id="player"><source src=".../720p.mp4">…
            const sourceTags = document.querySelectorAll("#player source, video source, video#player source");
            for (const s of sourceTags) {
                const src = s.getAttribute("src");
                if (src && (src.includes(".mp4") || src.includes(".m3u8"))) {
                    return src;
                }
            }
            // 2) Embed iframe (DoodStream, MEGA, dst.)
            const iframeSelectors = [
                "#player iframe",
                ".player-frame iframe",
                "#video-player iframe",
                "iframe[src*='filemoon']",
                "iframe[src*='streamtape']",
                "iframe[src*='vidnest']",
                "iframe[src*='playmogo']",
                "iframe[src*='streampoi']",
                "iframe[src*='filedon']",
                "iframe[src*='pixeldrain']",
                "iframe[src*='dood']",
                "iframe[src*='mega']",
                "iframe[src*='drive']",
                "iframe[src*='mediafire']",
                "iframe",
            ];
            for (const selector of iframeSelectors) {
                const iframe = document.querySelector(selector);
                if (iframe) {
                    const src = iframe.getAttribute("src") ||
                        iframe.getAttribute("data-src") ||
                        iframe.getAttribute("data-lazy-src");
                    if (src && !src.includes("about:blank")) {
                        return src;
                    }
                }
            }
            // 3) Last resort: paksa ekstrak via Puppeteer extractStream helper
            console.warn("[kura] No source/iframe in DOM, trying Puppeteer extractStream");
            try {
                const extracted = await extractStream(normalized);
                if (extracted)
                    return extracted;
            }
            catch (e) {
                console.error("[kura] extractStream fallback failed:", e);
            }
            return "";
        }
        catch (e) {
            console.error("[kura] parseStreamUrl error:", e);
            return "";
        }
    }
};
export default kuramanimeParser;
