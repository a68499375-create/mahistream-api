const https = require('https');

async function test() {
  try {
    const dnsRes = await fetch("https://cloudflare-dns.com/dns-query?name=kuramanime.pro&type=A", {
      headers: { "Accept": "application/dns-json" }
    });
    const dnsJson = await dnsRes.json();
    const ips = dnsJson.Answer.filter(a => a.type === 1).map(a => a.data);
    console.log("Resolved IPs:", ips);

    if (ips.length === 0) throw new Error("No IPs found");

    const options = {
      hostname: ips[0],
      port: 443,
      path: '/',
      method: 'GET',
      headers: {
        'Host': 'kuramanime.pro',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      servername: 'kuramanime.pro'
    };

    const req = https.request(options, (res) => {
      console.log('Status:', res.statusCode);
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => console.log('Data length:', data.length));
    });

    req.on('error', e => console.error('Req error:', e));
    req.end();

  } catch (e) {
    console.error("Error:", e);
  }
}

test();
