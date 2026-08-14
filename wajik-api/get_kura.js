async function get() {
  const r = await fetch('https://campsite.bio/kuramanime');
  const t = await r.text();
  const links = t.match(/https:\/\/kuramanime\.[a-z]+/g);
  console.log(links ? Array.from(new Set(links)) : "No links found");
}
get();
