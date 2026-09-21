"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

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
    <div className="min-h-screen bg-muted/40 p-4">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {navItems.map((item) => (
            <Button
              key={item.key}
              variant={current === item.key ? "default" : "outline"}
              size="sm"
              onClick={() => (window.location.href = item.href)}
            >
              {item.label}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => (window.location.href = "/dashboard")}>
            Dashboard
          </Button>
          {role === "ADMIN" && (
            <Button variant="outline" size="sm" onClick={() => (window.location.href = "/admin")}>
              Admin
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => signOut({ callbackUrl: "/login" })}>
            Sign out
          </Button>
        </div>
      </header>
      {children}
    </div>
  );
}
