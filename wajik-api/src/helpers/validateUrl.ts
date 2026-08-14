export function validateProxyUrl(url: string): { valid: boolean; reason?: string } {
  if (!url) return { valid: false, reason: "URL is required" };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: "Invalid URL format" };
  }

  // Only allow http/https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, reason: "Only http/https URLs allowed" };
  }

  // Block private/internal IPs
  const hostname = parsed.hostname;
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname === "169.254.169.254" || // AWS metadata
    hostname.startsWith("169.254.") ||
    hostname === "[::1]" ||
    hostname === "metadata.google.internal"
  ) {
    return { valid: false, reason: "Internal/private URLs not allowed" };
  }

  return { valid: true };
}
