import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import { initializeWhatsApp, setSocketServer } from "./lib/whatsapp";
import { startNotificationWorker, sweepOverdueValidations } from "./lib/travel/notifications";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

app.prepare().then(async () => {
  const httpServer = createServer(handler);
  const io = new Server(httpServer, {
    path: "/api/socket",
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  setSocketServer(io);

  setTimeout(() => {
    initializeWhatsApp().catch((err) => {
      console.error("[WhatsApp] initialization error:", err);
    });
  }, 2000);

  // Travel module: async delivery of queued workflow notifications (email +
  // WhatsApp). DB-backed outbox, so the Next.js bundle and this server share
  // state through SQLite, not process memory.
  startNotificationWorker();
  setInterval(() => {
    sweepOverdueValidations().catch((err) => {
      console.error("[Travel] overdue sweep error:", err);
    });
  }, 60 * 60 * 1000);

  httpServer
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, hostname, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});
