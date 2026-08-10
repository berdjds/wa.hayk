import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getWhatsAppState, logoutWhatsApp, initializeWhatsApp } from "@/lib/whatsapp";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(getWhatsAppState());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (body.action === "logout") {
    await logoutWhatsApp();
    // Re-initialize after logout so a new QR is generated
    setTimeout(() => initializeWhatsApp().catch(() => null), 1000);
    return NextResponse.json({ ok: true, ...getWhatsAppState() });
  }

  if (body.action === "reconnect") {
    setTimeout(() => initializeWhatsApp().catch(() => null), 1000);
    return NextResponse.json({ ok: true, ...getWhatsAppState() });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
