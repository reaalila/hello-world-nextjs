import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import LoginPage from "./login/page";

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/profile");
  }

  return <LoginPage />;
}