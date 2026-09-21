import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import bcrypt from "bcryptjs";
import { z } from "zod";

// WhatsApp notification destination: digits with an optional leading +
// (stored without the +, matching the schema comment on User.phone).
const phoneSchema = z
  .string()
  .regex(/^\+?\d{7,15}$/, "expected 7-15 digits, optional leading +")
  .transform((v) => v.replace(/^\+/, ""))
  .nullish();

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(4),
  role: z.enum(["ADMIN", "USER", "ADVISOR", "VALIDATOR"]).default("USER"),
  phone: phoneSchema,
});

const updateSchema = z.object({
  id: z.string().min(1),
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
  role: z.enum(["ADMIN", "USER", "ADVISOR", "VALIDATOR"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(4).optional(),
  phone: phoneSchema,
});

const deleteSchema = z.object({
  id: z.string().min(1),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, name: true, role: true, active: true, phone: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  try {
    const hashed = await bcrypt.hash(parsed.data.password, 10);
    const user = await prisma.user.create({
      data: {
        email: parsed.data.email,
        name: parsed.data.name,
        password: hashed,
        role: parsed.data.role,
        phone: parsed.data.phone ?? null,
      },
      select: { id: true, email: true, name: true, role: true, active: true, phone: true, createdAt: true },
    });

    await writeAuditLog("USER_CREATED", session.user.id, `Created ${user.email}`);

    return NextResponse.json(user);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to create user" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  const { id, password, ...rest } = parsed.data;
  const data: any = { ...rest };
  if (password) data.password = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, role: true, active: true, phone: true, createdAt: true },
    });

    await writeAuditLog("USER_UPDATED", session.user.id, `Updated ${user.email}`);

    return NextResponse.json(user);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to update user" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // Prevent self-deletion
  if (id === session.user.id) {
    return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
  }

  try {
    await prisma.user.delete({ where: { id } });
    await writeAuditLog("USER_DELETED", session.user.id, `Deleted user ${id}`);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to delete user" }, { status: 500 });
  }
}
