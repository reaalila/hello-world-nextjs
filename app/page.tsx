import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";

export default async function HomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Visitors can browse the community without signing in.
  if (!user) {
    redirect("/community");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", user.id)
    .single();

  const profileComplete =
    Boolean(profile?.first_name?.trim()) &&
    Boolean(profile?.last_name?.trim());

  if (!profileComplete) {
    redirect("/profile");
  }

  redirect("/captions");
}
