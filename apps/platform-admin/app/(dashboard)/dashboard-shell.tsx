"use client";

import { AdminShell, ThemeToggle, demoNotifications, type NavItem } from "@folkshops/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LogoutButton } from "./logout-button";

// Only what differs from merchant-admin lives here — see that app's
// dashboard-shell.tsx. The chrome itself is @folkshops/ui's AdminShell.
const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", iconPath: "M4 12l8-8 8 8M6 10v10h12V10" },
  { href: "/tenants", label: "Tenants", iconPath: "M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1" },
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
      notifications={demoNotifications()}
      assistantName="Platform Copilot"
    >
      {children}
    </AdminShell>
  );
}
