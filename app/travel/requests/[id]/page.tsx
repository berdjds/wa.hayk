import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isTravelRole } from "@/lib/travel/contracts";
import RequestDetail from "@/components/travel/detail/RequestDetail";

export default async function TravelRequestPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!isTravelRole(session.user.role)) redirect("/dashboard");

  return <RequestDetail requestId={params.id} role={session.user.role} userId={session.user.id} />;
}
