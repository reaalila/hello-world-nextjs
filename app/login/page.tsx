
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";

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
    <main className="account-screen">
      <div className="account-card">

        <div className="account-icon">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4.5 20c.5-4 3.3-6 7.5-6s7 2 7.5 6" />
          </svg>
        </div>

        <h1>Welcome</h1>

        <p className="account-description">
          Sign in or create an account to continue.
        </p>

        <button
          className="account-google-button"
          onClick={signInWithGoogle}
          disabled={loading}
        >
          <span className="account-google-mark">G</span>
          {loading
            ? "Connecting to Google..."
            : "Continue with Google"}
        </button>

        {errorMessage && (
          <p className="account-error" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    </main>
  );
}
