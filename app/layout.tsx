import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Littleleaf 小叶英语 · 每一次开口，都在长大",
  description: "带上自己的教材，和小叶老师一起听、说、圈画，开启一堂有回应的英语课。",
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
