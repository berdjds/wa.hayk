import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import CatalogAdmin from "@/components/travel/CatalogAdmin";

export default async function TravelCatalogPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/travel");

  return <CatalogAdmin role={session.user.role} userId={session.user.id} />;
}
