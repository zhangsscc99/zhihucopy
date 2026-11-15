require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { createApp } = require("./app");
const { getDb } = require("./db");
const { closeLog } = require("./logger");

getDb(); // run migrations at boot

const PORT = Number(process.env.PORT || 3030);
const app = createApp();
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[zhihucopy] listening on http://127.0.0.1:${PORT} (base /zhihucopy)`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    closeLog().finally(() => process.exit(0));
  });
}
process.on("exit", () => {
  closeLog();
});
