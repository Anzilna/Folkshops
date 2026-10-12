"use client";

import { AdminShell, ThemeToggle, type NavItem } from "@folkshops/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LogoutButton } from "./logout-button";
import { useActivityFeed } from "./use-activity-feed";

// Only what differs from merchant-admin lives here — see that app's
// dashboard-shell.tsx. The chrome itself is @folkshops/ui's AdminShell.
// The bell shows real platform events (useActivityFeed). There is no chat
// widget: the only assistant this project has is tenant-scoped (ai-service
// runs under a store's RLS), and a canned one would just invent numbers.
const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", iconPath: "M4 12l8-8 8 8M6 10v10h12V10" },
  { href: "/tenants", label: "Tenants", iconPath: "M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1" },
  { href: "/plans", label: "Plans", iconPath: "M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01" },
  { href: "/knowledge", label: "Help docs", iconPath: "M4 4h12a2 2 0 012 2v14H6a2 2 0 01-2-2V4zM8 8h6M8 12h6M18 8h2v12" },
  { href: "/activity", label: "Activity", iconPath: "M3 12h4l3-8 4 16 3-8h4" },
  {
    href: "/team",
    label: "Team",
    iconPath: "M16 19v-1.5a3.5 3.5 0 00-3.5-3.5h-5A3.5 3.5 0 004 17.5V19M9 11a3 3 0 100-6 3 3 0 000 6zM20 19v-1.5a3.5 3.5 0 00-2.5-3.35M16 5.2a3 3 0 010 5.6",
  },
  {
    href: "/settings",
    label: "Settings",
    iconPath:
      "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.14.42.75 1 1.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z",
  },
];

interface DashboardShellProps {
  adminEmail: string;
  children: ReactNode;
}

export function DashboardShell({ adminEmail, children }: DashboardShellProps) {
  const pathname = usePathname();
  const { items, markRead, markAllRead } = useActivityFeed();

  return (
    <AdminShell
      brand="Platform Admin"
      brandMark="P"
      navItems={NAV_ITEMS}
      pathname={pathname}
      LinkComponent={Link}
      accountLabel={adminEmail}
      accountSublabel="Folkshops staff"
      accountAction={<LogoutButton />}
      headerRight={<ThemeToggle />}
      notifications={items}
      onMarkNotificationRead={markRead}
      onMarkAllNotificationsRead={markAllRead}
    >
      {children}
    </AdminShell>
  );
}
