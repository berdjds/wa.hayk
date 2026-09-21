"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import pkg from "../../package.json";

interface TravelShellProps {
  title: string;
  subtitle?: string;
  role: string;
  /** Key of the active nav item, for highlighting. */
  current?: string;
  children: React.ReactNode;
}

const NAV = [
  { key: "requests", href: "/travel", label: "Requests" },
  { key: "review", href: "/travel/review", label: "Review queue" },
  { key: "templates", href: "/travel/templates", label: "Templates" },
  { key: "notifications", href: "/travel/notifications", label: "Notifications" },
];

const ADMIN_NAV = [
  { key: "agencies", href: "/travel/agencies", label: "Agencies" },
  { key: "catalog", href: "/travel/catalog", label: "Catalog" },
  { key: "settings", href: "/travel/settings", label: "Settings" },
];

export default function TravelShell({ title, subtitle, role, current, children }: TravelShellProps) {
  const navItems = role === "ADMIN" ? [...NAV, ...ADMIN_NAV] : NAV;
  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link href="/travel" className="flex shrink-0 items-center gap-2">
            <span className="text-lg font-bold tracking-tight">WAControl</span>
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">Travel</span>
          </Link>
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {navItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  current === item.key
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard">Dashboard</Link>
            </Button>
            {role === "ADMIN" && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/admin">Admin</Link>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => signOut({ callbackUrl: "/login" })}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {children}
      </main>

      <footer className="border-t bg-background">
        <div className="mx-auto flex h-12 max-w-7xl flex-wrap items-center justify-between gap-2 px-4 text-xs text-muted-foreground">
          <span>
            WAControl Travel · v{pkg.version} · © {new Date().getFullYear()}
          </span>
          <span>B2B quotations &amp; packages</span>
        </div>
      </footer>
    </div>
  );
}
