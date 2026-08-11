import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { sendWhatsAppMessage, getWhatsAppState } from "@/lib/whatsapp";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const sendSchema = z.object({
  remoteJid: z.string().min(1),
  body: z.string().optional(),
  type: z.enum(["text", "image", "voice", "document"]).default("text"),
  mediaBase64: z.string().optional(),
  mediaMimeType: z.string().optional(),
  mediaFilename: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (getWhatsAppState().state !== "ready") {
    console.log("[API /send] rejected: WhatsApp not ready");
    return NextResponse.json({ error: "WhatsApp client not ready" }, { status: 503 });
  }

  const body = await req.json();
  console.log("[API /send] request body:", body);
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    console.log("[API /send] validation failed:", parsed.error.errors);
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  try {
    const result = await sendWhatsAppMessage(parsed.data);
    console.log("[API /send] sendWhatsAppMessage result:", result);

    await prisma.log.create({
      data: {
        action: "SEND_MESSAGE",
        userId: session.user.id,
        details: `Sent ${parsed.data.type} to ${parsed.data.remoteJid}`,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to send message" }, { status: 500 });
  }
}
