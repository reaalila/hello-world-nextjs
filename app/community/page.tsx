import { createClient } from "@/lib/supabase-server";
import CommunityApp from "./community-app";

export default async function CommunityPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <CommunityApp userId={user?.id ?? null} />;
}
