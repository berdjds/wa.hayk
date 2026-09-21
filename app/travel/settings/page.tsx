import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import SettingsPanel from "@/components/travel/SettingsPanel";

export default async function TravelSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/travel");

  return <SettingsPanel role={session.user.role} userId={session.user.id} />;
}
