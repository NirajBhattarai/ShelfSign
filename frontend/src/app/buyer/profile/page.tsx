"use client";

import { useRouter } from "next/navigation";
import { useProfile } from "@/lib/useProfile";
import { supabase } from "@/lib/supabase";
import { DetailRow, PageHeader } from "@/components/ui";

export default function BuyerProfilePage() {
  const router = useRouter();
  const { profile } = useProfile();

  return (
    <div>
      <PageHeader
        title="Account"
        description="Your buyer profile on ShelfSign. Profile editing isn't available yet."
      />

      <div
        className="panel panel-pad"
        style={{ maxWidth: 520, marginBottom: 20 }}
      >
        <DetailRow label="Company" value={profile?.company_name ?? "—"} />
        <DetailRow label="Role" value="Buyer" />
        <DetailRow label="Account ID" value={profile?.id ?? "—"} mono />
      </div>

      <button
        className="btn btn-ghost"
        onClick={() =>
          supabase.auth.signOut().then(() => router.push("/login"))
        }
      >
        Sign out
      </button>
    </div>
  );
}
