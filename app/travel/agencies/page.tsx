import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import AgenciesAdmin from "@/components/travel/AgenciesAdmin";

export default async function TravelAgenciesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/travel");

  return <AgenciesAdmin role={session.user.role} />;
}
