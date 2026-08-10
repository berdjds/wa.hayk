import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import ChatDashboard from "@/components/dashboard/ChatDashboard";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return <ChatDashboard isAdmin={session.user.role === "ADMIN"} />;
}
