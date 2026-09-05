import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ShelfSign",
  description: "Camera-backed stock, signed from the silicon.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
