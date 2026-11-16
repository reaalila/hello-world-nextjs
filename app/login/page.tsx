"use client";

import { useState } from "react";
import { Bricolage_Grotesque, DM_Sans } from "next/font/google";
import { createClient } from "@/lib/supabase-browser";
import styles from "./login.module.css";

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

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function signInWithGoogle() {
    setLoading(true);
    setErrorMessage("");

    try {
      const supabase = createClient();

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );

      setLoading(false);
    }
  }

  return (
    <main
      className={`${headingFont.variable} ${bodyFont.variable} ${styles.page}`}
    >
      <section
        className={styles.loginCard}
        aria-labelledby="login-heading"
      >
        {/* BRAND */}
        <div className={styles.brand}>
          <span
            className={styles.brandSymbol}
            aria-hidden="true"
          >
            ✳
          </span>
          <span>NYC Sidequest</span>
        </div>

        {/* INTRODUCTION */}
        <div className={styles.introduction}>
          <p className={styles.eyebrow}>
            SIGN IN TO START EXPLORING
          </p>

          <h1
            id="login-heading"
            className={styles.title}
          >
            Welcome!
          </h1>

          <p className={styles.description}>
            Sign in to create and share your own NYC
            adventures.
          </p>
        </div>

        {/* GOOGLE SIGN-IN */}
        <button
          type="button"
          className={styles.googleButton}
          onClick={signInWithGoogle}
          disabled={loading}
        >
          <span
            className={styles.googleMark}
            aria-hidden="true"
          >
            G
          </span>

          <span className={styles.googleText}>
            {loading
              ? "Connecting to Google..."
              : "Continue with Google"}
          </span>

          <span
            className={styles.buttonArrow}
            aria-hidden="true"
          >
            ↗
          </span>
        </button>

        {/* ERROR MESSAGE */}
        {errorMessage && (
          <p
            className={styles.errorMessage}
            role="alert"
          >
            {errorMessage}
          </p>
        )}
      </section>
    </main>
  );
}
