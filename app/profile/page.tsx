import AvatarUpload from "./avatar-upload";
import ProfileForm from "./profile-form";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";

export default async function ProfilePage() {
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
    .select("first_name, last_name, avatar_url")
    .eq("id", user.id)
    .single();

  return (
      <main className="profile-page">
        <div className="profile-card">
          <h1>My Profile</h1>
          <p className="subtitle">
            Manage your personal information
          </p>

          <p>Email: {user.email}</p>

          <AvatarUpload
            initialAvatarUrl={profile?.avatar_url ?? null}
          />

          <h2 className="personal-info-title">
            Personal Information
          </h2>

          <ProfileForm
            initialFirstName={profile?.first_name ?? ""}
            initialLastName={profile?.last_name ?? ""}
          />
        </div>
      </main>
  );



}
