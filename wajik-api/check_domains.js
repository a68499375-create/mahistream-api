const domains = [
  "https://kuramanime.vip",
  "https://kuramanime.org",
  "https://kuramanime.biz",
  "https://kuramanime.bz",
  "https://kuramanime.net",
  "https://kuramanime.com"
];

async function check() {
  for (const url of domains) {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'manual' });
      console.log(url, "->", res.status, res.headers.get('location') || '');
    } catch (e) {
      console.log(url, "->", e.message);
    }
  }
}
check();
