import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';
// Add stealth plugin and use defaults (all evasion techniques)
let browserInstance = null;
let pluginAdded = false;
export const getBrowser = async () => {
    if (!browserInstance) {
        console.log("Menyiapkan Puppeteer Browser (Bypass Cloudflare)...");
        if (!pluginAdded) {
            // @ts-ignore
            puppeteer.use(StealthPlugin());
            pluginAdded = true;
        }
        try {
            // @ts-ignore
            browserInstance = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                ],
            });
            console.log("Puppeteer Browser siap!");
        }
        catch (e) {
            console.error("Puppeteer Failed to launch:", e);
            throw e;
        }
    }
    return browserInstance;
};
export const fetchWithPuppeteer = async (url) => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    // Blokir resource yang tidak penting agar lebih cepat (gambar, css, font)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
            req.abort();
        }
        else {
            req.continue();
        }
    });
    try {
        // Navigate with a generous timeout to allow Cloudflare challenge to pass
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Wait for either the content to load OR check if we are stuck on CF challenge
        // For kuramanime, we can wait for body to be populated
        await page.waitForFunction('document.body.innerText.length > 500', { timeout: 15000 }).catch(() => { });
        const html = await page.content();
        return html;
    }
    catch (error) {
        console.error(`Puppeteer fetch failed for ${url}:`, error);
        throw error;
    }
    finally {
        await page.close();
    }
};
