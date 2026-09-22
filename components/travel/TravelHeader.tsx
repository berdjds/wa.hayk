"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Menu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/travel", label: "Requests", match: (p: string) => p === "/travel" || p.startsWith("/travel/requests") },
  { href: "/travel/review", label: "Review queue", match: (p: string) => p.startsWith("/travel/review") },
  { href: "/travel/templates", label: "Templates", match: (p: string) => p.startsWith("/travel/templates") },
  { href: "/travel/notifications", label: "Notifications", match: (p: string) => p.startsWith("/travel/notifications") },
];

const ADMIN_NAV = [
  { href: "/travel/agencies", label: "Agencies", match: (p: string) => p.startsWith("/travel/agencies") },
  { href: "/travel/catalog", label: "Catalog", match: (p: string) => p.startsWith("/travel/catalog") },
  { href: "/travel/settings", label: "Settings", match: (p: string) => p.startsWith("/travel/settings") },
];

interface TravelHeaderProps {
  role: string;
  userName: string | null;
  userEmail: string | null;
}

/**
 * Travel module chrome (v0.12.0) — rendered once by app/travel/layout.tsx.
 * The active nav pill is derived from the pathname, so pages no longer pass a
 * `current` key. Seven+ items overflow on small screens: desktop pills hide
 * below md and a hamburger menu takes over.
 */
export default function TravelHeader({ role, userName, userEmail }: TravelHeaderProps) {
  const pathname = usePathname();
  const isAdmin = role === "ADMIN";
  const items = isAdmin ? [...NAV, ...ADMIN_NAV] : NAV;

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="px-2 md:hidden" aria-label="Open navigation">
              <Menu className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {items.map((item) => (
              <DropdownMenuItem key={item.href} asChild>
                <Link href={item.href} className={cn(item.match(pathname) && "font-semibold text-primary")}>
                  {item.label}
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard">Chat dashboard</Link>
            </DropdownMenuItem>
            {isAdmin && (
              <DropdownMenuItem asChild>
                <Link href="/admin">Admin panel</Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Link href="/travel" className="flex shrink-0 items-center gap-2">
          <span className="text-lg font-bold tracking-tight">WAControl</span>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">Travel</span>
        </Link>

        <nav className="hidden flex-1 items-center gap-1 md:flex">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                item.match(pathname)
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center md:ml-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <span className="hidden max-w-[160px] truncate sm:inline">{userName || userEmail}</span>
                <Badge variant="outline" className="text-xs font-normal">
                  {role}
                </Badge>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{userName || "—"}</p>
                  <p className="text-xs leading-none text-muted-foreground">{userEmail}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/dashboard">Chat dashboard</Link>
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem asChild>
                  <Link href="/admin">Admin panel</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
