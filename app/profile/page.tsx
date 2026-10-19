import Link from "next/link";
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

  const isOnboarding =
    !profile?.first_name?.trim() ||
    !profile?.last_name?.trim();

  return (
    <main className="profile-page">
      <div className="profile-card">
        <div className="profile-topbar">
          <div className="profile-heading">
            <h1>
              {isOnboarding
                ? "Complete Your Profile"
                : "My Profile"}
            </h1>

            <div className="profile-account-email">
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
              <span>{user.email}</span>
            </div>
          </div>

          {!isOnboarding && (
            <Link
              href="/captions"
              className="profile-back-link"
            >
              ← Back to Caption Generator
            </Link>
          )}
        </div>

        {isOnboarding && (
          <p className="profile-onboarding-note">
            Add your information to get started.
          </p>
        )}

        <AvatarUpload
          initialAvatarUrl={profile?.avatar_url ?? null}
        />

        <h2 className="personal-info-title">
          Personal Information
        </h2>

        <ProfileForm
          initialFirstName={profile?.first_name ?? ""}
          initialLastName={profile?.last_name ?? ""}
          isOnboarding={isOnboarding}
        />
      </div>
    </main>
  );
}
