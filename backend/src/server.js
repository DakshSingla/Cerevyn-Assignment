import { app, logger } from "./app.js";
import { config } from "./config.js";
import { db } from "./db.js";

const server = app.listen(config.port, config.host, () => logger.info({ host: config.host, port: config.port }, "Sales assistant API listening"));
function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
