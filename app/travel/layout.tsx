import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import TravelHeader from "@/components/travel/TravelHeader";
import pkg from "@/package.json";

/**
 * Travel module route layout (v0.12.0): header + page background + slim footer
 * live here instead of being re-wrapped by every page through TravelShell.
 * Pages still guard themselves (redirect on no session / no travel access);
 * the header simply hides when there is no session.
 */
export default async function TravelLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      {session?.user && (
        <TravelHeader
          role={session.user.role}
          userName={session.user.name ?? null}
          userEmail={session.user.email ?? null}
        />
      )}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t bg-background">
        <div className="mx-auto flex h-10 max-w-7xl items-center justify-center px-4 text-xs text-muted-foreground">
          WAControl Travel · v{pkg.version} · B2B quotations &amp; packages
        </div>
      </footer>
    </div>
  );
}
