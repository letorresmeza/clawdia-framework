import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SoulMD App",
  description: "Authenticated Mission Control dashboard for SoulMD operators.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
