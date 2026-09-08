import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Folkshops",
  description: "Multi-tenant e-commerce platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
