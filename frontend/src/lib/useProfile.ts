"use client";

import { useEffect, useState } from "react";
import { supabase, type Profile } from "./supabase";

interface ProfileState {
  loading: boolean;
  profile: Profile | null;
}

// Client-side auth guard: resolves the signed-in user's profile row, or
// null once resolved with no session. Pages redirect off `loading`/`profile`.
export function useProfile(): ProfileState {
  const [state, setState] = useState<ProfileState>({
    loading: true,
    profile: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;

      if (!user) {
        if (!cancelled) setState({ loading: false, profile: null });
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (!cancelled)
        setState({ loading: false, profile: (profile as Profile) ?? null });
    }

    load();
    const { data: subscription } = supabase.auth.onAuthStateChange(() =>
      load(),
    );

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return state;
}
