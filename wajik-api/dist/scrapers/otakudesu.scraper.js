import otakudesuConfig from "../configs/otakudesu.config.js";
import getHTMLViaFlareSolverr, { getHTMLViaFlareSolverrPost } from "../helpers/getHTMLViaFlareSolverr.js";
import { parse } from "node-html-parser";
const { baseUrl } = otakudesuConfig;
const otakudesuScraper = {
    async scrapeDOM(pathname, ref, sanitize = false) {
        const url = new URL(pathname, baseUrl).toString();
        const html = await getHTMLViaFlareSolverr(url, 30000, [], "otakudesu");
        const document = parse(html, {
            parseNoneClosedTags: true,
        });
        return document;
    },
    async scrapeNonce(body, referer) {
        // PENTING: admin-ajax.php WAJIB POST. GET return body "0" (WP default
        // untuk action tidak terdaftar) → parser dapat nonce kosong → resolve
        // stream selalu "No iframe found".
        const url = new URL("/wp-admin/admin-ajax.php", baseUrl).toString();
        const html = await getHTMLViaFlareSolverrPost(url, body, 30000, [{ name: "Referer", value: referer }], "otakudesu");
        const { parse } = await import("node-html-parser");
        const doc = parse(html);
        const text = (doc.querySelector("pre")?.text || html).trim();
        try {
            return JSON.parse(text);
        }
        catch {
            return { data: "" };
        }
    },
    async scrapeServer(body, referer) {
        const url = new URL("/wp-admin/admin-ajax.php", baseUrl).toString();
        const html = await getHTMLViaFlareSolverrPost(url, body, 30000, [{ name: "Referer", value: referer }], "otakudesu");
        const { parse } = await import("node-html-parser");
        const doc = parse(html);
        const text = (doc.querySelector("pre")?.text || html).trim();
        try {
            return JSON.parse(text);
        }
        catch {
            return { data: "" };
        }
    },
};
export default otakudesuScraper;
