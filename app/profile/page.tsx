import Link from "next/link";
import { redirect } from "next/navigation";
import { Bricolage_Grotesque, DM_Sans } from "next/font/google";
import { createClient } from "@/lib/supabase-server";
import AccountMenu from "@/app/components/account-menu";
import AvatarUpload from "./avatar-upload";
import ProfileForm from "./profile-form";
import styles from "./profile.module.css";

const headingFont = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sidequest-heading",
});

const bodyFont = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sidequest-body",
});

export default async function ProfilePage() {
  const supabase = await createClient();

  // Check that the user is signed in.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  // Load the user's existing profile.
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, avatar_url")
    .eq("id", user.id)
    .single();

  // Determine whether the profile is complete.
  const isOnboarding =
    !profile?.first_name?.trim() ||
    !profile?.last_name?.trim();

  return (
    <main
      className={`${headingFont.variable} ${bodyFont.variable} ${styles.page}`}
    >
      <div className={styles.shell}>
        {/* NAVIGATION */}
        <header className={styles.siteHeader}>
          <nav
            className={styles.nav}
            aria-label="Main navigation"
          >
            <Link
              href="/community"
              className={styles.logo}
            >
              <span
                className={styles.logoStar}
                aria-hidden="true"
              >
                ✳
              </span>
              NYC Sidequest
            </Link>

            <div className={styles.navLinks}>
              <Link
                href="/community"
                className={styles.navLink}
              >
                EXPLORE
              </Link>

              <Link
                href="/sidequest"
                className={styles.navLink}
              >
                CREATE
              </Link>

              {/* Shared profile icon dropdown */}
              <AccountMenu isLoggedIn={true} />
            </div>
          </nav>
        </header>

        {/* PROFILE CARD */}
        <section
          className={styles.profileCard}
          aria-labelledby="profile-heading"
        >
          {/* HEADING AND EMAIL */}
          <div className={styles.cardHeader}>
            <h1
              id="profile-heading"
              className={styles.pageTitle}
            >
              {isOnboarding
                ? "Complete your profile"
                : "My profile"}
            </h1>

            <p className={styles.accountEmail}>
              <span>Signed in as</span>
              <strong>{user.email}</strong>
            </p>

            {isOnboarding && (
              <p className={styles.onboardingHelp}>
                Add your first and last name to continue.
              </p>
            )}
          </div>

          {/* PROFILE PHOTO */}
          <div className={styles.photoArea}>
            <AvatarUpload
              initialAvatarUrl={
                profile?.avatar_url ?? null
              }
            />
          </div>

          {/* PERSONAL INFORMATION */}
          <div className={styles.formRegion}>
            <ProfileForm
              initialFirstName={
                profile?.first_name ?? ""
              }
              initialLastName={
                profile?.last_name ?? ""
              }
              isOnboarding={isOnboarding}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
