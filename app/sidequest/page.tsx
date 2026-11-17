import Link from "next/link";
import { Bricolage_Grotesque, DM_Sans } from "next/font/google";
import { createClient } from "@/lib/supabase-server";
import AccountMenu from "@/app/components/account-menu";
import SideQuestClient from "./sidequest-client";
import styles from "./sidequest.module.css";

export const dynamic = "force-dynamic";

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

export default async function SideQuestPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed-in users see the full AI generator.
  if (user) {
    return <SideQuestClient />;
  }

  // Signed-out users see a simplified introduction.
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
                className={styles.activeNavLink}
                aria-current="page"
              >
                CREATE
              </Link>

              <AccountMenu isLoggedIn={false} />
            </div>
          </nav>
        </header>

        {/* SIMPLIFIED PUBLIC CREATE PREVIEW */}
        <section
            className={styles.createCard}
             aria-labelledby="create-heading"
             style={{
               minHeight: "clamp(360px, 48vh, 480px)",
                 display: "flex",
                 flexDirection: "column",
                 justifyContent: "center",
          }}
        >
          <div className={styles.formHeading}>
            <div>
              <p className={styles.formEyebrow}>
                YOUR NEXT SIDEQUEST
              </p>

              <h1
                id="create-heading"
                className={styles.formTitle}
              >
                What would you like to explore?
              </h1>

              <p className={styles.formDescription}>
                Discover NYC your way, with a personalized
                  adventure built around your interests,
                  time, and budget.
              </p>
            </div>

            <span
              className={styles.formFlower}
              aria-hidden="true"
            >
              ✳
            </span>
          </div>

          <div style={{ marginTop: "20px" }}>
            <Link
                href="/login"
                className={styles.primaryButton}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                  padding: "22px 38px",
                  fontSize: "15px",
                  fontWeight: 800,
                  minHeight: "64px",
              }}
            >
              SIGN IN TO CREATE ↗
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
