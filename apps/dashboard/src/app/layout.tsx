import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clawdia Dashboard",
  description: "Agent infrastructure dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <Nav />
        <main className="ml-56 min-h-screen p-6">{children}</main>
      </body>
    </html>
  );
}
