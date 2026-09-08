import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Folkshops Platform Admin",
  description: "Internal Folkshops platform administration",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
