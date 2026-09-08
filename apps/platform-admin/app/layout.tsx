import type { Metadata } from "next";
import { ThemeProvider, ThemeScript } from "@folkshops/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "Folkshops Platform Admin",
  description: "Internal Folkshops platform administration",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
