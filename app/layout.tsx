import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Teeko · 陪孩子开口说英语",
  description: "一个爸爸的英语陪学尝试。看图、聊天、画一画，和 Teeko 一起练习英语表达。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
