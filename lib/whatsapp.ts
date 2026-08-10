import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import type { Socket as ServerSocket, Server as SocketServer } from "socket.io";
import { prisma } from "@/lib/prisma";
import QRCode from "qrcode";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import mime from "mime-types";

export type ConnectionState =
  | "initializing"
  | "qr"
  | "authenticated"
  | "ready"
  | "disconnected"
  | "auth_failure";

interface WhatsAppServiceState {
  client: Client | null;
  state: ConnectionState;
  qrSvg: string | null;
  info: string;
  io: SocketServer | null;
}

const state: WhatsAppServiceState = {
  client: null,
  state: "initializing",
  qrSvg: null,
  info: "Initializing WhatsApp client...",
  io: null,
};

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

async function ensureUploadDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

async function upsertChat(remoteJid: string, name?: string | null, profilePicUrl?: string | null) {
  const existing = await prisma.chat.findUnique({
    where: { remoteJid },
  });

  if (existing) {
    const updateData: any = { lastMessageAt: new Date() };
    if (name && !existing.name) updateData.name = name;
    if (profilePicUrl) updateData.profilePicUrl = profilePicUrl;
    return prisma.chat.update({ where: { remoteJid }, data: updateData });
  }

  return prisma.chat.create({
    data: {
      remoteJid,
      name: name || remoteJid.split("@")[0],
      profilePicUrl,
    },
  });
}

async function persistMessage(msg: any, fromMe: boolean) {
  try {
    const chat = await msg.getChat();
    const remoteJid = chat.id._serialized;
    const contact = msg.fromMe ? await chat.getContact() : await msg.getContact();
    const name = contact?.pushname || contact?.name || chat.name || undefined;

    // Try to fetch profile picture for the chat once in a while
    let profilePicUrl: string | null = null;
    try {
      profilePicUrl = await state.client?.getProfilePicUrl(remoteJid) || null;
    } catch {
      profilePicUrl = null;
    }

    const chatRecord = await upsertChat(remoteJid, name, profilePicUrl);

    const type = getTypeMessageType(msg);
    let mediaUrl: string | null = null;
    let mediaMimeType: string | null = null;
    let mediaCaption: string | null = msg.body || null;

    if (msg.hasMedia) {
      const media = await msg.downloadMedia();
      if (media && media.data) {
        await ensureUploadDir();
        const ext = mime.extension(media.mimetype) || "bin";
        const filename = `${randomUUID()}.${ext}`;
        const filepath = path.join(UPLOAD_DIR, filename);
        await fs.writeFile(filepath, Buffer.from(media.data, "base64"));
        mediaUrl = `/uploads/${filename}`;
        mediaMimeType = media.mimetype;
        if (!mediaCaption && media.filename) mediaCaption = media.filename;
      }
    }

    const body = msg.body || (type !== "text" ? mediaCaption : null) || "";

    // Avoid duplicate messages when both sendMessage() and the message_create event fire
    const existingId = msg.id?._serialized;
    if (existingId) {
      const existing = await prisma.message.findUnique({
        where: { whatsappMessageId: existingId },
      });
      if (existing) return;
    }

    const messageRecord = await prisma.message.create({
      data: {
        chatId: chatRecord.id,
        remoteJid,
        whatsappMessageId: msg.id?._serialized || null,
        fromMe,
        body,
        type,
        mediaUrl,
        mediaMimeType,
        mediaCaption,
        timestamp: new Date(msg.timestamp * 1000),
      },
    });

    state.io?.emit("message", {
      ...messageRecord,
      chat: chatRecord,
    });

    state.io?.emit("chat_update", chatRecord);
  } catch (err) {
    console.error("[WhatsApp] persistMessage error:", err);
  }
}

function getTypeMessageType(msg: any): string {
  if (msg.hasMedia) {
    if (msg.type === "ptt" || msg.type === "audio") return "voice";
    if (msg.type === "image") return "image";
    if (msg.type === "document") return "document";
    if (msg.type === "video") return "video";
    if (msg.type === "sticker") return "sticker";
    return "media";
  }
  if (msg.type === "chat" || msg.type === "text") return "text";
  return msg.type || "unknown";
}

export function setSocketServer(io: SocketServer) {
  state.io = io;
  io.on("connection", (socket: ServerSocket) => {
    socket.emit("whatsapp_state", {
      state: state.state,
      qrSvg: state.qrSvg,
      info: state.info,
    });
  });
}

export function getWhatsAppState() {
  return { state: state.state, qrSvg: state.qrSvg, info: state.info };
}

export async function initializeWhatsApp() {
  if (state.client) return state.client;

  state.info = "Initializing WhatsApp client...";

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(process.cwd(), ".wwebjs_auth") }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    },
  });

  client.on("qr", async (qr: string) => {
    state.state = "qr";
    try {
      const svg = await QRCode.toString(qr, { type: "svg", margin: 2, width: 256 });
      state.qrSvg = svg;
      state.info = "Scan the QR code with WhatsApp on your phone.";
    } catch {
      state.qrSvg = null;
      state.info = "Failed to generate QR code.";
    }
    state.io?.emit("whatsapp_state", getWhatsAppState());
  });

  client.on("authenticated", () => {
    state.state = "authenticated";
    state.qrSvg = null;
    state.info = "Authenticated. Loading chats...";
    state.io?.emit("whatsapp_state", getWhatsAppState());
  });

  client.on("auth_failure", (msg: string) => {
    state.state = "auth_failure";
    state.info = `Authentication failure: ${msg}`;
    state.io?.emit("whatsapp_state", getWhatsAppState());
  });

  client.on("ready", async () => {
    state.state = "ready";
    state.info = "WhatsApp client is ready.";
    state.qrSvg = null;
    await prisma.whatsAppSession.upsert({
      where: { sessionId: "default" },
      update: { connected: true, info: state.info },
      create: { sessionId: "default", connected: true, info: state.info },
    });
    state.io?.emit("whatsapp_state", getWhatsAppState());
  });

  client.on("disconnected", async (reason: any) => {
    state.state = "disconnected";
    state.info = `Disconnected: ${reason}`;
    state.qrSvg = null;
    await prisma.whatsAppSession.upsert({
      where: { sessionId: "default" },
      update: { connected: false, info: state.info },
      create: { sessionId: "default", connected: false, info: state.info },
    });
    state.io?.emit("whatsapp_state", getWhatsAppState());
  });

  client.on("message_create", async (msg: any) => {
    // Fires for both incoming and outgoing messages
    await persistMessage(msg, msg.fromMe);
  });

  client.on("change_state", (st: any) => {
    console.log("[WhatsApp] state change:", st);
  });

  state.client = client;
  await client.initialize();
  return client;
}

export async function logoutWhatsApp() {
  if (!state.client) return;
  try {
    await state.client.logout();
    await state.client.destroy();
  } catch (e) {
    console.error("[WhatsApp] logout error:", e);
  }
  state.client = null;
  state.state = "disconnected";
  state.qrSvg = null;
  state.info = "Logged out. Re-initializing...";
  state.io?.emit("whatsapp_state", getWhatsAppState());
}

export async function sendWhatsAppMessage({
  remoteJid,
  body,
  type,
  mediaBase64,
  mediaMimeType,
  mediaFilename,
}: {
  remoteJid: string;
  body?: string;
  type: "text" | "image" | "voice" | "document";
  mediaBase64?: string;
  mediaMimeType?: string;
  mediaFilename?: string;
}) {
  if (!state.client) throw new Error("WhatsApp client not initialized");
  if (state.state !== "ready") throw new Error("WhatsApp client not ready");

  const chatId = remoteJid.includes("@") ? remoteJid : `${remoteJid}@c.us`;

  // Normalize number if needed
  let finalChatId = chatId;
  if (!chatId.includes("@g.us")) {
    try {
      const numberId = await state.client.getNumberId(chatId.replace("@c.us", ""));
      if (numberId && numberId._serialized) {
        finalChatId = numberId._serialized;
      }
    } catch {
      // fall back to provided id
    }
  }

  let message;
  if (type !== "text" && mediaBase64 && mediaMimeType) {
    const media = new MessageMedia(mediaMimeType, mediaBase64, mediaFilename || "file");
    message = await state.client.sendMessage(finalChatId, media, {
      caption: body || undefined,
      sendAudioAsVoice: type === "voice",
    });
  } else {
    message = await state.client.sendMessage(finalChatId, body || "");
  }

  return message;
}

export async function markChatAsRead(remoteJid: string) {
  if (!state.client || state.state !== "ready") return;
  try {
    const chat = await state.client.getChatById(remoteJid);
    await chat.sendSeen();
  } catch (e) {
    console.error("[WhatsApp] markChatAsRead error:", e);
  }
}

export async function getChatById(client: Client, chatId: string) {
  return client.getChatById(chatId);
}
