import errorinCuy from "./errorinCuy.js";
import sanitizeHtml from "sanitize-html";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Browser, Page } from "puppeteer";
// Get the actual puppeteer-extra instance
const puppeteerExtra = puppeteer.default || puppeteer;
puppeteerExtra.use(StealthPlugin());
export const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
let browserPromise = null;
export async function getBrowser() {
    if (!browserPromise) {
        browserPromise = (async () => {
            // ISP Bypass: Petakan domain ke IP Cloudflare Edge (menghindari blokir DNS)
            const bypassRules = [
                "MAP otakudesu.blog 104.21.84.148",
                "MAP *.otakudesu.blog 104.21.84.148",
                "MAP otakudesu.best 104.21.84.148",
                "MAP *.otakudesu.best 104.21.84.148",
                "MAP otakudesu.cloud 104.21.84.148",
                "MAP *.otakudesu.cloud 104.21.84.148",
                "MAP nekopoi.care 104.21.84.148",
                "MAP *.nekopoi.care 104.21.84.148",
                "MAP kuramanime.ing 104.21.66.92",
                "MAP *.kuramanime.ing 104.21.66.92",
                "MAP kuramanime.work 104.21.66.92",
                "MAP *.kuramanime.work 104.21.66.92",
                "MAP kuramanime.blog 104.21.66.92",
                "MAP *.kuramanime.blog 104.21.66.92",
                "MAP kuramanime.com 104.21.66.92",
                "MAP *.kuramanime.com 104.21.66.92"
            ].join(",");
            const proxyArgs = process.env.KURA_TUNNEL_PROXY ? [`--proxy-server=${process.env.KURA_TUNNEL_PROXY}`] : [];
            const instance = await puppeteerExtra.launch({
                headless: true,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--no-zygote",
                    "--single-process",
                    `--host-resolver-rules="${bypassRules}"`,
                    ...proxyArgs
                ]
            });
            instance.on("disconnected", () => {
                browserPromise = null;
            });
            return instance;
        })();
    }
    return browserPromise;
}
export default async function getHTML(baseUrl, pathname, ref, sanitize = false, waitForSelector, waitForSelectorTimeout) {
    const targetUrl = new URL(pathname, baseUrl).toString();
    const parsedUrl = new URL(pathname, baseUrl);
    const targetServer = parsedUrl.searchParams.get("server");
    // Check if this is Nekopoi index page - optimize for speed
    const isNekopoiIndex = baseUrl.includes("nekopoi") && (pathname.includes("-list") || pathname.includes("genre"));
    const isNekopoi = baseUrl.includes("nekopoi");
    // Default waitForSelector timeout (15s), longer for nekopoi (30s)
    const defaultWaitTimeout = isNekopoi ? 30000 : 15000;
    const waitTimeout = waitForSelectorTimeout ?? defaultWaitTimeout;
    // BYPASS: Proxy removed because cors.caliph.my.id is dead/timing out.
    // We will rely purely on Puppeteer Stealth for Samehadaku and Kuramanime.
    // Fallback to Puppeteer for Otakudesu (due to DNS blocks)
    const browser = await getBrowser();
    let page = null;
    try {
        page = await browser.newPage();
        await page.setUserAgent(userAgent);
        // Speed optimization: Block ads, tracking, stylesheets, and images for Nekopoi
        if (isNekopoi) {
            await page.setRequestInterception(true);
            page.on("request", (req) => {
                const type = req.resourceType();
                const url = req.url();
                if (type === "image" ||
                    type === "stylesheet" ||
                    type === "font" ||
                    type === "media" ||
                    url.includes("google-analytics") ||
                    url.includes("doubleclick") ||
                    url.includes("adservice") ||
                    url.includes("histats") ||
                    url.includes("popads") ||
                    url.includes("onclickads") ||
                    url.includes("exoclick") ||
                    url.includes("adsystem") ||
                    url.includes("cpm")) {
                    req.abort();
                }
                else {
                    req.continue();
                }
            });
        }
        else if (baseUrl.includes("kuramanime")) {
            // For Kuramanime, we need to keep some resources for Cloudflare challenge
            // but we can still block obvious ads
            await page.setRequestInterception(true);
            page.on("request", (req) => {
                const type = req.resourceType();
                const url = req.url();
                if (type === "font" ||
                    url.includes("google-analytics") ||
                    url.includes("doubleclick") ||
                    url.includes("adservice") ||
                    url.includes("histats") ||
                    url.includes("popads") ||
                    url.includes("onclickads") ||
                    url.includes("exoclick") ||
                    url.includes("adsystem") ||
                    url.includes("cpm")) {
                    req.abort();
                }
                else {
                    req.continue();
                }
            });
        }
        if (ref) {
            await page.setExtraHTTPHeaders({
                referer: ref.startsWith("http") ? ref : new URL(ref, baseUrl).toString()
            });
        }
        // For Nekopoi index pages, skip two-step navigation and go directly
        if (isNekopoiIndex) {
            console.log(`[getHTML] Direct navigation to Nekopoi index: ${targetUrl}`);
            await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        }
        else {
            // Use two-step navigation to reliably solve Cloudflare challenge on baseUrl first
            console.log(`[getHTML] page.goto baseUrl start: ${baseUrl}`);
            await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: isNekopoi ? 30000 : 60000 });
            // Wait for Cloudflare challenge bypass if detected
            let title = "";
            const maxWaitLoops = isNekopoi ? 20 : 30;
            for (let i = 0; i < maxWaitLoops; i++) {
                title = await page.title();
                console.log(`[getHTML] Loop check title: "${title}"`);
                if (title && !title.includes("Just a moment") && !title.includes("Attention Required")) {
                    break;
                }
                if (title && (title.includes("Just a moment") || title.includes("Attention Required"))) {
                    // Tunggu lebih lama untuk Cloudflare challenge
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                else {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            // Now navigate to the deep target URL (will load instantly since cookies are established)
            if (pathname && pathname !== "/" && pathname !== "") {
                console.log(`[getHTML] page.goto targetUrl start: ${targetUrl}`);
                await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: isNekopoi ? 20000 : 25000 });
                console.log(`[getHTML] targetUrl completed, final title: "${await page.title()}"`);
            }
        }
        if (targetServer) {
            console.log(`[getHTML] Selecting server: ${targetServer}`);
            await page.evaluate((srv) => {
                const select = document.querySelector("#changeServer");
                if (select) {
                    select.value = srv;
                    select.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }, targetServer);
            // Wait for select/change loading to complete
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        if (waitForSelector) {
            await page.waitForSelector(waitForSelector, { timeout: waitTimeout }).catch(() => { });
        }
        const html = await page.content();
        if (!html.trim()) {
            throw errorinCuy(404);
        }
        return applySanitization(html, sanitize);
    }
    catch (err) {
        console.error("Puppeteer Error:", err);
        throw errorinCuy(500);
    }
    finally {
        if (page) {
            await page.close();
        }
    }
}
function applySanitization(html, sanitize) {
    if (sanitize) {
        return sanitizeHtml(html, {
            allowedTags: [
                "address", "article", "aside", "footer", "header", "h1", "h2", "h3", "h4", "h5", "h6",
                "main", "nav", "section", "blockquote", "div", "dl", "figcaption", "figure", "hr", "li",
                "main", "ol", "p", "pre", "ul", "a", "abbr", "b", "br", "code", "data", "em", "i", "mark",
                "span", "strong", "sub", "sup", "time", "u", "img"
            ],
            allowedAttributes: {
                a: ["href", "name", "target"],
                img: ["src"],
                "*": ["class", "id"],
            },
        });
    }
    return html;
}
