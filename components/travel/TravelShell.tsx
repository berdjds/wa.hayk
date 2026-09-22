"use client";

interface TravelShellProps {
  title: string;
  subtitle?: string;
  role: string;
  /** @deprecated Active nav state is derived from the pathname in TravelHeader. */
  current?: string;
  children: React.ReactNode;
}

/** Page title block used inside travel pages (below the layout's header). */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

/**
 * Compatibility wrapper (v0.12.0): the chrome (header/nav/footer) moved to
 * app/travel/layout.tsx, so this renders only the page header + content.
 * Pages migrate to PageHeader directly as they are restyled; role/current are
 * accepted so untouched callers keep compiling.
 */
export default function TravelShell({ title, subtitle, children }: TravelShellProps) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      {children}
    </>
  );
}
