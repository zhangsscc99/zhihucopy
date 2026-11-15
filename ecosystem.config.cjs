module.exports = {
  apps: [
    {
      name: "zhihucopy",
      cwd: "/www/zhihucopy",
      script: "server/index.js",
      env: {
        NODE_ENV: "production",
        PORT: "3030",
      },
    },
  ],
};
