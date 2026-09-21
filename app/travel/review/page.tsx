import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isTravelRole } from "@/lib/travel/contracts";
import ReviewQueue from "@/components/travel/ReviewQueue";

export default async function TravelReviewPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!isTravelRole(session.user.role)) redirect("/dashboard");

  return <ReviewQueue role={session.user.role} userId={session.user.id} />;
}
