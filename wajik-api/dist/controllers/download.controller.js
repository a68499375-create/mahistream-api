import extractStream from "../helpers/extractStream.js";
import setPayload from "../helpers/setPayload.js";
const QUALITIES = ["360p", "480p", "720p", "1080p"];
const MIRRORS = ["filedon", "googledrive", "mediafire", "pixeldrain", "streamtape", "vidnest", "playmogo", "streampoi"];
const downloadController = {
    async getDownloadOptions(req, res) {
        try {
            const serverId = req.query.serverId;
            const animeId = req.query.animeId;
            const episode = req.query.episode;
            if (!serverId && !animeId) {
                return res.status(400).json(setPayload(res, { message: "serverId or animeId is required" }));
            }
            let streamUrl = serverId;
            if (!serverId && animeId && episode) {
                // Try to get stream URL from episode
                // This would need to be implemented based on the source
                // For now, return structured response
            }
            if (!streamUrl) {
                return res.status(400).json(setPayload(res, { message: "Stream URL not found" }));
            }
            // Check if it's already a direct stream URL
            const isDirectStream = /\.(mp4|m3u8)(\?|$)/i.test(streamUrl);
            const downloadOptions = [];
            if (isDirectStream) {
                // Direct stream - provide as single option with quality detection from URL
                const quality = extractQualityFromUrl(streamUrl) || "720p";
                downloadOptions.push({
                    quality,
                    url: streamUrl,
                    mirror: "direct",
                    direct: true,
                });
            }
            else {
                // Need to extract from embed page - try multiple mirrors
                const extractedUrl = await extractStreamWithTimeout(streamUrl, 15000);
                if (extractedUrl) {
                    const quality = extractQualityFromUrl(extractedUrl) || "720p";
                    const mirror = detectMirror(extractedUrl);
                    downloadOptions.push({
                        quality,
                        url: extractedUrl,
                        mirror,
                        direct: true,
                    });
                }
                // Add original as fallback
                downloadOptions.push({
                    quality: "auto",
                    url: streamUrl,
                    mirror: "embed",
                    direct: false,
                });
            }
            // Generate multiple quality options if we have a direct URL
            const primaryOption = downloadOptions.find(o => o.direct);
            if (primaryOption) {
                const multiQualityOptions = generateQualityVariants(primaryOption.url, primaryOption.mirror);
                downloadOptions.push(...multiQualityOptions);
            }
            // Deduplicate by quality+mirror
            const seen = new Set();
            const unique = downloadOptions.filter(opt => {
                const key = `${opt.quality}-${opt.mirror}`;
                if (seen.has(key))
                    return false;
                seen.add(key);
                return true;
            });
            // Sort by quality (highest first)
            unique.sort((a, b) => {
                const qa = parseQuality(a.quality);
                const qb = parseQuality(b.quality);
                return qb - qa;
            });
            return res.status(200).json(setPayload(res, {
                data: {
                    downloadOptions: unique,
                    animeId,
                    episode,
                }
            }));
        }
        catch (e) {
            console.error("Download options error:", e);
            return res.status(500).json(setPayload(res, { message: "Failed to get download options" }));
        }
    },
    async download(req, res) {
        try {
            const url = req.query.url;
            const filename = req.query.filename || "video.mp4";
            if (!url) {
                return res.status(400).json(setPayload(res, { message: "URL is required" }));
            }
            // Proxy the download with Range header support for resume
            const range = req.headers.range;
            const headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://nekopoi.care/",
            };
            if (range) {
                headers["Range"] = range;
            }
            const response = await fetch(url, { headers });
            if (!response.ok) {
                return res.status(response.status).json(setPayload(res, { message: "Failed to fetch video" }));
            }
            // Set appropriate headers for download
            res.setHeader("Content-Type", response.headers.get("content-type") || "video/mp4");
            res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
            res.setHeader("Accept-Ranges", "bytes");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
            if (response.headers.has("content-length")) {
                const contentLength = response.headers.get("content-length");
                if (contentLength)
                    res.setHeader("Content-Length", contentLength);
            }
            if (response.headers.has("content-range")) {
                const contentRange = response.headers.get("content-range");
                if (contentRange)
                    res.setHeader("Content-Range", contentRange);
            }
            if (response.headers.has("accept-ranges")) {
                const acceptRanges = response.headers.get("accept-ranges");
                if (acceptRanges)
                    res.setHeader("Accept-Ranges", acceptRanges);
            }
            if (response.body) {
                const { Readable } = await import('stream');
                const readable = Readable.fromWeb(response.body);
                readable.pipe(res);
            }
            else {
                res.end();
            }
        }
        catch (e) {
            console.error("Download proxy error:", e);
            if (!res.headersSent) {
                res.status(500).json(setPayload(res, { message: "Download failed" }));
            }
        }
    },
};
function extractQualityFromUrl(url) {
    const match = url.match(/(\d{3,4})p/i);
    return match ? `${match[1]}p` : null;
}
function detectMirror(url) {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes("filedon"))
        return "filedon";
    if (hostname.includes("google") || hostname.includes("drive"))
        return "googledrive";
    if (hostname.includes("mediafire"))
        return "mediafire";
    if (hostname.includes("pixeldrain"))
        return "pixeldrain";
    if (hostname.includes("streamtape"))
        return "streamtape";
    if (hostname.includes("vidnest"))
        return "vidnest";
    if (hostname.includes("playmogo"))
        return "playmogo";
    if (hostname.includes("streampoi"))
        return "streampoi";
    return "unknown";
}
function parseQuality(quality) {
    const match = quality.match(/(\d+)/);
    const num = match ? match[1] : undefined;
    return num ? parseInt(num, 10) : 0;
}
function generateQualityVariants(baseUrl, mirror) {
    // For some hosts, we can generate quality variants by modifying URL
    // This is a simplified version - real implementation would depend on host
    const variants = [];
    // Only generate for known hosts that support quality selection
    if (mirror === "filedon" || mirror === "googledrive") {
        for (const q of QUALITIES) {
            // Skip if same as base quality
            const baseQuality = extractQualityFromUrl(baseUrl);
            if (baseQuality && baseQuality === q)
                continue;
            variants.push({
                quality: q,
                url: baseUrl, // In reality, this would be a different URL per quality
                mirror,
                direct: true,
            });
        }
    }
    return variants;
}
async function extractStreamWithTimeout(url, timeoutMs) {
    return Promise.race([
        extractStream(url),
        new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
}
export default downloadController;
