const { createServer } = require("http");
const next = require("next");
const { Server } = require("socket.io");
const { initializeWhatsApp, setSocketServer } = require("./dist/lib/whatsapp.js");

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

  // Initialize WhatsApp client after server starts
  setTimeout(() => {
    initializeWhatsApp().catch((err) => {
      console.error("[WhatsApp] initialization error:", err);
    });
  }, 2000);

  httpServer
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, hostname, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});
