import { load } from "cheerio";
// nekopoi.care has rotated through several layouts (legacy `.eropost`,
// intermediate `.nk-post-card`, newer card themes). Each helper below tries
// every known selector family so we degrade gracefully when the site swaps
// class names again.
const ABSOLUTE_HOSTS = [
    "nekopoi.care",
    "nekopoi.com",
    "nekopoi.net",
    "nekopoi.cc",
    "nekopoi.in"
];
const slugFromHref = (href) => {
    if (!href)
        return "";
    try {
        return new URL(href).pathname.replace(/^\/|\/$/g, "");
    }
    catch {
        for (const host of ABSOLUTE_HOSTS) {
            const idx = href.indexOf(`${host}/`);
            if (idx !== -1) {
                return href.substring(idx + host.length + 1).replace(/\/$/, "");
            }
        }
        return href.replace(/^\/+/, "").replace(/\/+$/, "");
    }
};
const extractBgImage = ($el) => {
    const style = $el.attr("style") || "";
    const m = style.match(/url\(['"]?(.*?)['"]?\)/i);
    if (m && m[1])
        return m[1];
    const dataBg = $el.attr("data-bg") || $el.attr("data-background") || $el.attr("data-src");
    return dataBg || "";
};
const firstNonEmpty = (...values) => {
    for (const v of values) {
        if (v && v.trim())
            return v.trim();
    }
    return "";
};
// Pull a single listing item (used by both latest and search). Returns null
// when essential fields are missing so the caller can skip junk rows.
function parseCard($, el) {
    const $el = $(el);
    // Find the primary anchor: prefer one wrapping a heading, then any direct
    // anchor with an href that looks like a post.
    let anchor = $el.find("h2 a, h3 a, h4 a, .title a, .entry-title a").first();
    if (!anchor.length)
        anchor = $el.find("a[href*='/']").first();
    if (!anchor.length && $el.is("a"))
        anchor = $el;
    const href = anchor.attr("href");
    const id = slugFromHref(href);
    if (!id)
        return null;
    // Title: prefer dedicated heading text (single line), fallback to anchor's
    // own attributes/text. Older search layouts wrapped the entire card in a
    // single anchor whose `.text()` concatenated the heading AND the synopsis,
    // producing strings like "Title\n\nSinopsis: ...". That polluted any
    // downstream filter or classify regex (e.g. matching "tahun baru" inside
    // synopsis), so we trim aggressively to the first non-empty line.
    let rawTitle = firstNonEmpty($el.find(".nk-post-title, .post-title, .entry-title, .title, h2, h3, h4").first().text(), anchor.attr("title"), anchor.text(), $el.find("img").first().attr("alt"));
    // Keep only the first non-empty line so trailing synopsis text is dropped.
    const firstLine = rawTitle.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0) || "";
    const title = firstLine
        .replace(/\s+Sinopsis\s*:.*$/i, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    if (!title)
        return null;
    // Image: try <img>, then any element with a CSS background-image.
    const $img = $el.find("img").first();
    let image = firstNonEmpty($img.attr("data-src"), $img.attr("data-lazy-src"), $img.attr("src"));
    if (!image) {
        const $bg = $el.find(".nk-thumb-crop, .nk-search-thumb, .thumb, .thumbnail, .post-thumb, [style*='background-image']").first();
        if ($bg.length)
            image = extractBgImage($bg);
    }
    return { id, title, image, type: "hentai" };
}
const LISTING_SELECTORS = [
    ".nk-post-card",
    ".nk-search-item",
    ".eropost",
    ".result",
    ".post-card",
    "article.post",
    ".listupd .bs",
    ".bs",
    "article",
    ".main-info"
];
function collectListing(html) {
    const $ = load(html);
    const seen = new Set();
    const results = [];
    for (const sel of LISTING_SELECTORS) {
        const nodes = $(sel);
        if (!nodes.length)
            continue;
        nodes.each((_, el) => {
            const item = parseCard($, el);
            if (!item)
                return;
            if (seen.has(item.id))
                return;
            seen.add(item.id);
            results.push(item);
        });
        if (results.length > 0) {
            console.log(`[NEKOPOI PARSER] listing matched selector="${sel}" count=${results.length}`);
            break;
        }
    }
    // Last-ditch fallback: scan every anchor that points to a post-shaped URL.
    if (results.length === 0) {
        console.log("[NEKOPOI PARSER] listing fell back to anchor scan");
        $("a[href*='nekopoi.care/']").each((_, el) => {
            const $a = $(el);
            const href = $a.attr("href");
            const id = slugFromHref(href);
            if (!id || id.includes("page/") || id.includes("category/") || id.includes("search/"))
                return;
            const title = firstNonEmpty($a.attr("title"), $a.text(), $a.find("img").attr("alt"));
            if (!title || title.length < 3)
                return;
            if (seen.has(id))
                return;
            seen.add(id);
            const $img = $a.find("img").first();
            const image = firstNonEmpty($img.attr("data-src"), $img.attr("src"));
            results.push({ id, title, image, type: "hentai" });
        });
    }
    return results;
}
const nekopoiParser = {
    parseLatest(html) {
        const results = collectListing(html);
        console.log(`[NEKOPOI PARSER] parseLatest -> ${results.length} items`);
        return results;
    },
    parseSearch(html) {
        const results = collectListing(html);
        console.log(`[NEKOPOI PARSER] parseSearch -> ${results.length} items`);
        return results;
    },
    // Index list parser — untuk halaman /hentai-list/, /jav-list/, /genre-list/.
    // Halaman index biasanya berisi banyak anchor di dalam grid/list tanpa
    // poster. Kita ekstrak semua anchor yang punya path konten valid (bukan
    // navigasi, category, atau auth link), normalize jadi { id, title, image }
    // supaya struktur konsisten dengan parseLatest dan bisa dipakai oleh
    // komponen card yang sama di frontend.
    parseIndexList(html) {
        const $ = load(html);
        const seen = new Set();
        const out = [];
        // Skip prefix yang bukan konten anime — ini halaman fungsional bukan
        // detail post.
        const NAV_BLOCK = new Set([
            "category", "tag", "page", "search", "login", "register", "cdn-cgi",
            "feed", "comments", "wp-admin", "wp-login", "wp-content", "wp-includes",
            "hentai-list", "jav-list", "genre-list", "kontak", "policy",
        ]);
        $("a[href]").each((_, el) => {
            const $a = $(el);
            const href = $a.attr("href") || "";
            const slug = slugFromHref(href);
            if (!slug)
                return;
            const firstSeg = slug.split("/")[0] || "";
            if (NAV_BLOCK.has(firstSeg))
                return;
            // Hanya anchor yang isi text-nya non-trivial (>3 huruf) yang dianggap
            // judul. Anchor "next page", "1", "2" diabaikan.
            const text = ($a.text() || "").replace(/\s+/g, " ").trim();
            if (!text || text.length < 3)
                return;
            if (/^\d+$/.test(text))
                return;
            if (seen.has(slug))
                return;
            seen.add(slug);
            out.push({ id: slug, title: text, image: "" });
        });
        console.log(`[NEKOPOI PARSER] parseIndexList -> ${out.length} items`);
        return out;
    },
    parseDetail(html, id) {
        const $ = load(html);
        const title = firstNonEmpty(
        // Modern player page exposes the series title via .nk-player-series-title;
        // older layouts use .nk-post-header h1, .erotitle h1, etc. Series pages have
        // a generic h1 inside "Informasi" widgets which leaks junk text — prefer
        // specific classes first and fall back to og:title / page <title> before
        // any generic h1 to avoid grabbing "Informasi Anime  1973 kali".
        $(".nk-player-series-title").first().text(), $(".nk-post-header h1").first().text(), $(".eropost h1, .erotitle h1, .erotitle").first().text(), $(".post-title, .entry-title, h1.title").first().text(), $('meta[property="og:title"]').attr("content"), $("title").first().text()?.split(/\s*[\|–-]\s*/)?.[0], $("h1").first().text())
            .replace(/\[NEW Release\]/gi, "")
            .replace(/Subtitle Indonesia/gi, "")
            .replace(/Sub Indo/gi, "")
            .trim();
        const image = firstNonEmpty($(".nk-player-series-thumb").attr("style")?.match(/url\(['"]?(.*?)['"]?\)/)?.[1], $(".nk-featured-img img").attr("src"), $(".eroimg img").attr("src"), $(".featured-image img, .post-thumbnail img, .thumb img").first().attr("src"), $('meta[property="og:image"]').attr("content"), $("article img").first().attr("src"));
        const synopsis = firstNonEmpty($(".nk-post-body .konten").text(), $(".eroinfo p").text(), $(".konten").text(), $(".synopsis, .description, .post-content p").first().text(), $("article p").first().text());
        const streamLinks = [];
        const serverList = [];
        const qualityFromText = (text) => {
            if (!text)
                return "";
            const m = text.match(/(\d{3,4})\s*p/i);
            return m ? `${m[1]}p` : "";
        };
        // Streaming tabs (current layout): each frame holds one iframe.
        // Modern layout uses #nk-player-tabs containing anchors with href="#nk-stream-N"
        // and matching <div id="nk-stream-N" class="nk-player-frame"><iframe ...></div>.
        // Build a tab id -> label map first so each frame gets the right server name.
        const tabLabelMap = {};
        $("#nk-player-tabs a, #nk-player .nav-tabs li a").each((_, a) => {
            const $a = $(a);
            const href = $a.attr("href") || "";
            const target = $a.attr("data-target") || href;
            const label = $a.text().trim();
            if (label && target.startsWith("#")) {
                tabLabelMap[target.slice(1)] = label;
            }
        });
        $("#nk-player .nk-player-frame, .nk-player-frame, .player-frame, [id^='nk-stream-']").each((idx, frameEl) => {
            const $frame = $(frameEl);
            const iframe = $frame.find("iframe").first();
            const src = iframe.attr("src") || iframe.attr("data-src") || iframe.attr("data-litespeed-src");
            if (!src)
                return;
            // Skip discord/ad iframes leaked by the page.
            if (/discordapp|a-ads|googlesyndication/i.test(src))
                return;
            let quality = "";
            const dataCandidates = [
                $frame.attr("data-quality"),
                $frame.attr("data-res"),
                $frame.attr("data-resolution")
            ];
            for (const c of dataCandidates) {
                const q = qualityFromText(c);
                if (q) {
                    quality = q;
                    break;
                }
            }
            if (!quality)
                quality = qualityFromText($frame.attr("id"));
            const frameId = $frame.attr("id") || "";
            const tabLabel = tabLabelMap[frameId] || "";
            if (!quality)
                quality = qualityFromText(tabLabel);
            if (!quality) {
                if (frameId) {
                    const tab = $(`#nk-player .nav-tabs li a[href="#${frameId}"], #nk-player .nav-tabs li a[data-target="#${frameId}"]`).first();
                    quality = qualityFromText(tab.text()) || qualityFromText(tab.attr("data-quality"));
                }
                if (!quality) {
                    const tabByIdx = $("#nk-player .nav-tabs li a").eq(idx);
                    quality = qualityFromText(tabByIdx.text()) || qualityFromText(tabByIdx.attr("data-quality"));
                }
            }
            const baseName = tabLabel || `Server ${idx + 1}`;
            const name = quality ? `${baseName} (${quality})` : baseName;
            streamLinks.push({ serverId: src, serverName: name, ...(quality ? { quality } : {}) });
            serverList.push({ serverId: src, title: name, ...(quality ? { quality } : {}) });
        });
        // Fallback: any standalone player iframe (older single-episode posts).
        if (streamLinks.length === 0) {
            const iframeSrc = firstNonEmpty($("#player iframe").attr("src"), $(".embed-player iframe").attr("src"), $(".player iframe").attr("src"), $("iframe[src*='player']").attr("src"), $("iframe[src*='embed']").attr("src"), $("iframe[src*='streampoi']").attr("src"), $("iframe[src*='streamtape']").attr("src"), $("iframe[src*='vidnest']").attr("src"), $("iframe[src*='playmogo']").attr("src"), $("article iframe").first().attr("src"));
            if (iframeSrc && !/discordapp|a-ads|googlesyndication/i.test(iframeSrc)) {
                streamLinks.push({ serverId: iframeSrc, serverName: "Nekopoi Player" });
                serverList.push({ serverId: iframeSrc, title: "Nekopoi Player" });
            }
        }
        // Download links: try the modern, intermediate, and legacy layouts in order.
        const downloadLinks = [];
        const pushDownload = (quality, links) => {
            const cleaned = links.filter(l => l.url);
            if (quality && cleaned.length > 0) {
                downloadLinks.push({ quality: quality.trim(), links: cleaned });
            }
        };
        $(".nk-download-section .nk-download-row, .nk-download-row").each((_, el) => {
            const $row = $(el);
            const rawName = $row.find(".nk-download-name, .quality, .name").first().text().trim();
            // Modern layout puts quality in brackets: "Title 2 [1080p]" → extract just "1080p".
            const qMatch = rawName.match(/\[?\b(\d{3,4}p)\b\]?/i);
            const quality = (qMatch && qMatch[1]) ? qMatch[1] : rawName;
            const links = [];
            $row.find(".nk-download-links a, p a, a").each((__, a) => {
                const href = $(a).attr("href");
                if (!href || href === "#")
                    return;
                const host = $(a).text().trim() || "Download";
                // Avoid the redundant "<b>LINK</b>" markers and empty anchors.
                if (host === "LINK" || host === "Link")
                    return;
                // Dedup within row.
                if (links.some((l) => l.url === href))
                    return;
                links.push({ host, url: href });
            });
            pushDownload(quality, links);
        });
        if (downloadLinks.length === 0) {
            $(".liner, .dlbod .liner, .download .liner").each((_, el) => {
                const $row = $(el);
                const quality = $row.find(".name, .quality, strong").first().text().trim();
                const links = [];
                $row.find(".listlink a, a").each((__, a) => {
                    const href = $(a).attr("href");
                    if (!href || href === "#")
                        return;
                    links.push({ host: $(a).text().trim() || "Download", url: href });
                });
                pushDownload(quality, links);
            });
        }
        if (downloadLinks.length === 0) {
            // Generic fallback: groups of links under headings inside any download section.
            $(".download, .dlbod, #download").find("h3, h4, strong, p").each((_, header) => {
                const $h = $(header);
                const quality = $h.text().trim();
                if (!quality)
                    return;
                const $next = $h.next();
                if (!$next.length)
                    return;
                const links = [];
                $next.find("a").each((__, a) => {
                    const href = $(a).attr("href");
                    if (!href || href === "#")
                        return;
                    links.push({ host: $(a).text().trim() || "Download", url: href });
                });
                pushDownload(quality, links);
            });
        }
        // Episode list (multi-episode series).
        // Modern layout uses anchor cards: <a class="nk-episode-card" href="..."> with
        // .nk-episode-badge ("Ep 1"), .nk-episode-card-title, .nk-episode-card-date,
        // and a thumb element with background-image. Older layouts use <li> in
        // .episodelist / .nk-episode-list / .episode-list / .eplist.
        const episodes = [];
        const seenEp = new Set();
        $("a.nk-episode-card, .nk-episode-card").each((_, el) => {
            const $card = $(el);
            const $a = $card.is("a") ? $card : $card.find("a").first();
            const href = $a.attr("href") || $card.attr("href");
            const epId = slugFromHref(href);
            if (!epId || seenEp.has(epId))
                return;
            const epTitle = $card.find(".nk-episode-card-title").first().text().trim()
                || $card.find(".nk-episode-card-info").first().text().trim();
            const dateText = $card.find(".nk-episode-card-date").first().text().trim();
            const badge = $card.find(".nk-episode-badge").first().text().trim();
            const numFromBadge = badge.match(/\d+/);
            const numFromTitle = epTitle.match(/episode\s*(\d+)/i);
            const numFromId = epId.match(/episode-(\d+)/i);
            const number = (numFromBadge && numFromBadge[0]) ||
                (numFromTitle && numFromTitle[1]) ||
                (numFromId && numFromId[1]) ||
                "";
            seenEp.add(epId);
            episodes.push({
                episodeId: epId,
                id: epId,
                title: epTitle || (number ? `Episode ${number}` : "Episode"),
                number,
                date: dateText,
            });
        });
        $(".episodelist ul li, .nk-episode-list li, .episode-list li, .eplist li").each((_, el) => {
            const $li = $(el);
            const $a = $li.find("a").first();
            const epTitle = $a.text().trim();
            const href = $a.attr("href");
            const epId = slugFromHref(href);
            if (!epTitle || !epId || seenEp.has(epId))
                return;
            seenEp.add(epId);
            const date = $li.find(".date, .ep-date, time").first().text().trim();
            const numMatch = epTitle.match(/episode\s*(\d+)/i) || epId.match(/-(\d+)(?:-|$)/);
            const number = numMatch ? numMatch[1] : "";
            episodes.push({ episodeId: epId, id: epId, title: epTitle, number, date });
        });
        episodes.sort((a, b) => {
            const na = parseInt(a.number || "0", 10);
            const nb = parseInt(b.number || "0", 10);
            return na - nb;
        });
        console.log(`[NEKOPOI PARSER] parseDetail id=${id} title="${title}" streams=${streamLinks.length} downloads=${downloadLinks.length} episodes=${episodes.length}`);
        return {
            id,
            title,
            image,
            synopsis,
            streamLinks,
            serverList,
            downloadLinks,
            episodes,
            episodeList: episodes
        };
    }
};
export default nekopoiParser;
