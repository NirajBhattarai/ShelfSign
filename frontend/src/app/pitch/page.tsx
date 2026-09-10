import type { Metadata, Viewport } from "next";
import PitchDeck from "./PitchDeck";

export const metadata: Metadata = {
  title: "ShelfSign Pitch",
  description:
    "Camera-backed stock, signed from the silicon — attested with a live nonce.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#08090A",
};

export default function PitchPage() {
  return <PitchDeck />;
}
