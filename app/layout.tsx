import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "MONSTERA AI", description: "Private AI workspace" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ko"><body className="min-h-screen bg-background text-foreground">{children}</body></html>; }
