const https = require('https');

function test(domain) {
  const req = https.request({
    hostname: '104.21.84.148',
    port: 443,
    path: '/',
    method: 'GET',
    headers: { 'Host': domain, 'User-Agent': 'curl' },
    servername: domain
  }, (res) => {
    console.log(domain, 'Status:', res.statusCode);
  });
  req.on('error', e => console.error(e));
  req.end();
}

test('v18.kuramanime.ing');
