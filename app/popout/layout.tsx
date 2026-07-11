import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Captions",
  robots: { index: false, follow: false },
};

export default function PopoutLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
