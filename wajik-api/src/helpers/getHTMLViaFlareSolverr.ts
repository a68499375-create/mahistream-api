import getHTML from "./getHTML.js";

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || "http://127.0.0.1:8191/v1";
const DEFAULT_SESSION_NAME = process.env.FLARESOLVERR_SESSION || "kuramanime";

let sessionId: string | null = null;
let creating: Promise<string> | null = null;

// Cookie age-gate: Kuramanime menyembunyikan konten 18+ (specials, OVA dewasa,
// dll.) di balik konfirmasi umur. Tanpa cookie ini, request langsung ke
// /anime/<id>/episode/<n> di-redirect ke halaman search dan parser menganggap
// "video tidak tersedia". Cookie `dewasa=1` cocok dengan tombol "Lanjutkan"
// di prompt umur dan diterima untuk konten umum (tidak ber-efek samping).
//
// PENTING: Chrome menolak SELURUH request kalau salah satu cookie domain-nya
// tidak match dengan url request (error "invalid cookie domain"). Jadi kita
// pilih cookie hanya untuk domain target — fungsi `cookiesForUrl` di bawah.
const ageGateCookies = (host: string) => {
  // Strip subdomain ke registrable domain supaya cookie berlaku lintas
  // varian (v18, v9, dll.). Contoh: "v18.kuramanime.ing" → ".kuramanime.ing".
  const parts = host.split(".");
  const tld = parts.slice(-2).join(".");
  return [
    { name: "dewasa", value: "1", domain: host },
    { name: "konfirmasi_umur", value: "1", domain: host },
    { name: "dewasa", value: "1", domain: `.${tld}` },
    { name: "konfirmasi_umur", value: "1", domain: `.${tld}` },
  ];
};

async function post(body: any, timeoutMs = 30000): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(FLARESOLVERR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`FlareSolverr HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function getSession(sessionName = DEFAULT_SESSION_NAME): Promise<string> {
  if (sessionId && sessionName === DEFAULT_SESSION_NAME) return sessionId;
  if (creating) return creating;
  creating = (async () => {
    // Reusing a named session keeps the warmed Chrome (and its Cloudflare
    // clearance) alive, so subsequent requests skip the ~18s challenge solve.
    const data = await post({ cmd: "sessions.create", session: sessionName });
    if (data.status !== "ok") {
      throw new Error(`FlareSolverr session create failed: ${data.message || "unknown"}`);
    }
    const id: string = data.session || sessionName;
    if (sessionName === DEFAULT_SESSION_NAME) sessionId = id;
    return id;
  })().finally(() => {
    creating = null;
  });
  return creating;
}

export default async function getHTMLViaFlareSolverr(url: string, maxTimeout = 55000, cookies?: any[], sessionName?: string): Promise<string> {
  let lastError = "";
  // PENTING: jangan pre-set cookies di request.get. Cloudflare bot challenge
  // dengan cookies non-standard sebelum challenge selesai bikin Chrome di
  // dalam Flare timeout ("Error solving the challenge. Timeout after 60s").
  // Cookie age-gate (dewasa/konfirmasi_umur) di-set lewat session pre-warm
  // bila perlu — sementara ini cukup andalkan Flare session persistence yang
  // sudah otomatis remember cookies dari response Set-Cookie.
  for (let attempt = 0; attempt < 2; attempt++) {
    let session;
    try {
      session = await getSession(sessionName);
    } catch (e: any) {
      console.warn("[FlareSolverr] Session creation failed, falling back to Puppeteer...");
      try {
        const parsedUrl = new URL(url);
        const html = await getHTML(parsedUrl.origin, parsedUrl.pathname + parsedUrl.search);
        return html;
      } catch (pupErr: any) {
        throw new Error(`FlareSolverr session failed and Puppeteer fallback failed: ${pupErr?.message || pupErr}`);
      }
    }

    let data: any;
    try {
      const payload: any = { cmd: "request.get", url, maxTimeout, session };
      if (cookies) payload.cookies = cookies;
      data = await post(payload);
    } catch (e: any) {
      if (sessionName === DEFAULT_SESSION_NAME) sessionId = null;
      lastError = e?.message || "request failed";

      console.warn(`[FlareSolverr] Request failed, falling back to Puppeteer for: ${url}`);
      try {
        const parsedUrl = new URL(url);
        const html = await getHTML(parsedUrl.origin, parsedUrl.pathname + parsedUrl.search);
        return html;
      } catch (pupErr: any) {
        console.error(`[FlareSolverr Fallback] Puppeteer also failed:`, pupErr?.message || pupErr);
      }
      continue;
    }

    if (data.status === "ok" && data.solution?.response) {
      return data.solution.response as string;
    }

    if (data.status !== "ok") {
      try {
        await post({ cmd: "sessions.destroy", session });
      } catch (err) {}
    }
    if (sessionName === DEFAULT_SESSION_NAME) sessionId = null;
    lastError = data.message || "no solution";
  }

  throw new Error(`FlareSolverr failed: ${lastError}`);
}

export async function getHTMLViaFlareSolverrPost(url: string, postData: string, maxTimeout = 55000, cookies?: any[], sessionName?: string): Promise<string> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let session;
    try {
      session = await getSession(sessionName);
    } catch (e: any) {
      console.warn("[FlareSolverr] Session creation failed, falling back to direct fetch POST...");
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        };
        if (cookies) {
          for (const c of cookies) {
            if (c.name === "Referer") headers["Referer"] = c.value;
          }
        }
        const res = await fetch(url, { method: "POST", body: postData, headers });
        return await res.text();
      } catch (pupErr: any) {
        throw new Error(`FlareSolverr session failed and fetch fallback failed: ${pupErr?.message || pupErr}`);
      }
    }

    let data: any;
    try {
      const payload: any = { cmd: "request.post", url, postData, maxTimeout, session };
      if (cookies) payload.cookies = cookies;
      data = await post(payload);
    } catch (e: any) {
      if (!sessionName || sessionName === DEFAULT_SESSION_NAME) sessionId = null;
      lastError = e?.message || "request failed";

      console.warn(`[FlareSolverr] POST request failed, falling back to direct fetch POST for: ${url}`);
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        };
        if (cookies) {
          for (const c of cookies) {
            if (c.name === "Referer") headers["Referer"] = c.value;
          }
        }
        const res = await fetch(url, { method: "POST", body: postData, headers });
        return await res.text();
      } catch (pupErr: any) {
        console.error(`[FlareSolverr Fallback] direct fetch also failed:`, pupErr?.message || pupErr);
      }
      continue;
    }

    if (data.status === "ok" && data.solution?.response) {
      return data.solution.response as string;
    }

    if (data.status !== "ok") {
      try {
        await post({ cmd: "sessions.destroy", session });
      } catch (err) {}
    }
    if (!sessionName || sessionName === DEFAULT_SESSION_NAME) sessionId = null;
    lastError = data.message || "no solution";
  }

  throw new Error(`FlareSolverr POST failed: ${lastError}`);
}
