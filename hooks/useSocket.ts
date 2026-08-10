"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

export interface WhatsAppState {
  state: string;
  qrSvg: string | null;
  info: string;
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [whatsAppState, setWhatsAppState] = useState<WhatsAppState | null>(null);
  const [lastEvent, setLastEvent] = useState<{ type: string; payload: any } | null>(null);

  useEffect(() => {
    const socket = io({
      path: "/api/socket",
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("whatsapp_state", (data) => setWhatsAppState(data));
    socket.on("message", (data) => setLastEvent({ type: "message", payload: data }));
    socket.on("chat_update", (data) => setLastEvent({ type: "chat_update", payload: data }));

    return () => {
      socket.disconnect();
    };
  }, []);

  return { socket: socketRef.current, connected, whatsAppState, lastEvent };
}
