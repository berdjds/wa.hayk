import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isTravelRole } from "@/lib/travel/contracts";
import NotificationsList from "@/components/travel/NotificationsList";

export default async function TravelNotificationsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!isTravelRole(session.user.role)) redirect("/dashboard");

  return <NotificationsList role={session.user.role} userId={session.user.id} />;
}
