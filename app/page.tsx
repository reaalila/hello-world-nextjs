import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import LoginPage from "./login/page";

export default async function HomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <LoginPage />;
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
