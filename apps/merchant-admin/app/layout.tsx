import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Folkshops Merchant Admin",
  description: "Merchant admin dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
