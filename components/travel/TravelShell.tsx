"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/** Page title block used inside travel pages (below the layout's chrome). */
export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  breadcrumb?: BreadcrumbItem[];
}) {
  return (
    <div className="mb-6">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-[13px] text-muted-foreground">
          {breadcrumb.map((item, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
              {item.href ? (
                <Link href={item.href} className="transition-colors hover:text-foreground">
                  {item.label}
                </Link>
              ) : (
                <span className="text-foreground">{item.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions}
      </div>
    </div>
  );
}

interface TravelShellProps {
  title: string;
  subtitle?: string;
  role: string;
  breadcrumb?: BreadcrumbItem[];
  /** @deprecated Active nav state is derived from the pathname in TravelSidebar. */
  current?: string;
  children: React.ReactNode;
}

/**
 * Compatibility wrapper: the chrome (sidebar/nav) lives in
 * app/travel/layout.tsx, so this renders only the page header + content.
 * Pages migrate to PageHeader directly as they are restyled; role/current are
 * accepted so untouched callers keep compiling.
 */
export default function TravelShell({ title, subtitle, breadcrumb, children }: TravelShellProps) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} breadcrumb={breadcrumb} />
      {children}
    </>
  );
}
