
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import CaptionApp from "./caption-app";

export default async function CaptionsPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
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

  return <CaptionApp userId={user.id} />;
}
