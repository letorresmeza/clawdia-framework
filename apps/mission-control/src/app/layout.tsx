import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SoulMD | Memory Infrastructure For AI Operators",
  description:
    "SoulMD is the public surface for an operator-grade AI system built around identity, memory, and controlled execution.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
