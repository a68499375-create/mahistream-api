module.exports = {
  apps: [
    {
      name: "wajik-anime-api",
      script: "dist/index.js",
      env: {
        KURA_TUNNEL_PROXY: "socks5://127.0.0.1:1080"
      }
    }
  ]
};
