import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";

export default async function SideQuestLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  // Only authenticated users can access the generator.
  if (error || !user) {
    redirect("/login");
  }

  return <>{children}</>;
}
