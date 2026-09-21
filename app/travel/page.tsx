import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessTravel } from "@/lib/travel/access";
import RequestsList from "@/components/travel/RequestsList";

export default async function TravelPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!(await canAccessTravel(session.user.id, session.user.role))) redirect("/dashboard");

  return <RequestsList role={session.user.role} userId={session.user.id} />;
}
