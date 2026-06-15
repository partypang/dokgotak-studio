import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "독고탁 스튜디오",
  description:
    "제품 이미지와 PDF를 한국어 판매 쇼츠 대본, 자막, 나레이션, 썸네일 문구로 바꾸는 AI 콘텐츠 제작 스튜디오.",
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
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
