import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const chatId = searchParams.get("chatId");
  const remoteJid = searchParams.get("remoteJid");

  if (!chatId && !remoteJid) {
    return NextResponse.json({ error: "chatId or remoteJid required" }, { status: 400 });
  }

  const where: any = {};
  if (chatId) where.chatId = chatId;
  else where.remoteJid = remoteJid;

  const messages = await prisma.message.findMany({
    where,
    orderBy: { timestamp: "asc" },
  });

  return NextResponse.json(messages);
}
