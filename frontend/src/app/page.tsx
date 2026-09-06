"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/lib/useProfile";

export default function HomePage() {
  const router = useRouter();
  const { loading, profile } = useProfile();

  useEffect(() => {
    if (loading) return;
    if (!profile) router.replace("/signup");
    else router.replace(profile.role === "supplier" ? "/supplier" : "/buyer");
  }, [loading, profile, router]);

  return null;
}
