import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessTravel } from "@/lib/travel/access";
import ReviewQueue from "@/components/travel/ReviewQueue";

export default async function TravelReviewPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!(await canAccessTravel(session.user.id, session.user.role))) redirect("/dashboard");

  return <ReviewQueue role={session.user.role} userId={session.user.id} />;
}
