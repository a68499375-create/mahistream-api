const https = require('https');

const req = https.request({
  hostname: '1.1.1.1',
  port: 443,
  path: '/',
  method: 'GET',
  headers: { 'Host': 'v2.samehadaku.how', 'User-Agent': 'curl' },
  servername: 'v2.samehadaku.how'
}, (res) => {
  console.log('Status:', res.statusCode);
});
req.end();
