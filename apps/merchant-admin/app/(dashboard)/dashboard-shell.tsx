"use client";

import { AdminShell, ThemeToggle, demoNotifications, type NavItem } from "@folkshops/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LogoutButton } from "./logout-button";

// Only what differs from platform-admin lives here: the nav, the brand, and
// which logout button. The chrome itself is @folkshops/ui's AdminShell.
const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", iconPath: "M4 12l8-8 8 8M6 10v10h12V10" },
  { href: "/products", label: "Products", iconPath: "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" },
  { href: "/orders", label: "Orders", iconPath: "M6 3h12l1 5H5l1-5zM5 8h14l-1.2 11.2A2 2 0 0115.8 21H8.2a2 2 0 01-2-1.8L5 8zM9 12h6" },
  { href: "/categories", label: "Categories", iconPath: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" },
  { href: "/inventory", label: "Inventory", iconPath: "M3 7h18v13H3V7zM3 7l2-4h14l2 4M9 11h6" },
  {
    href: "/customers",
    label: "Customers",
    iconPath: "M16 19v-1.5a3.5 3.5 0 00-3.5-3.5h-5A3.5 3.5 0 004 17.5V19M9 11a3 3 0 100-6 3 3 0 000 6zM20 19v-1.5a3 3 0 00-2.5-2.96M15 4.1a3 3 0 010 5.8",
  },
  {
    href: "/settings",
    label: "Settings",
    iconPath:
      "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.14.42.75 1 1.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z",
  },
];

interface DashboardShellProps {
  tenantName: string;
  userEmail: string;
  children: ReactNode;
}

export function DashboardShell({ tenantName, userEmail, children }: DashboardShellProps) {
  const pathname = usePathname();

  return (
    <AdminShell
      brand={tenantName}
      navItems={NAV_ITEMS}
      pathname={pathname}
      LinkComponent={Link}
      accountLabel={userEmail}
      accountSublabel="Store owner"
      accountAction={<LogoutButton />}
      headerRight={<ThemeToggle />}
      notifications={demoNotifications()}
      assistantName="Store Copilot"
    >
      {children}
    </AdminShell>
  );
}
