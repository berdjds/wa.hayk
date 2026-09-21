import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isTravelRole } from "@/lib/travel/contracts";
import TemplatesList from "@/components/travel/TemplatesList";

export default async function TravelTemplatesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!isTravelRole(session.user.role)) redirect("/dashboard");

  return <TemplatesList role={session.user.role} userId={session.user.id} />;
}
