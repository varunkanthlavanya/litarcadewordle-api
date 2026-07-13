import { createServer } from "node:http";
import { createApp, finalizeApp } from "./app.js";
import { createSocketServer } from "./websocket/index.js";
import { bootTimedWordleScheduler } from "./jobs/timedWordleScheduler.js";
import { createNotificationsAdminRouter, createNotificationsPlayerRouter } from "./modules/notifications/notifications.routes.js";
import { createCutoffAdminRouter } from "./modules/cutoff/cutoff.routes.js";
import { config } from "./config/index.js";

const app = createApp();
const httpServer = createServer(app);
const { timedWordleScheduler, notificationsService } = createSocketServer(httpServer);

app.use("/admin/events", createNotificationsAdminRouter(notificationsService));
app.use("/player/notifications", createNotificationsPlayerRouter(notificationsService));
app.use("/admin/events", createCutoffAdminRouter(notificationsService));

finalizeApp(app);

httpServer.listen(config.port, () => {
  console.log(`API listening on port ${config.port} (${config.nodeEnv})`);
});

bootTimedWordleScheduler(timedWordleScheduler).catch((err) => {
  console.error("Failed to boot Timed Wordle scheduler", err);
});
