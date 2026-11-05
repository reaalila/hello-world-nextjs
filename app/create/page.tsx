import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";

export default async function CreatePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed-in users use the real caption generator.
  if (user) {
    redirect("/captions");
  }

  // Visitors see a preview without generating anything.
  return (
    <main className="caption-page create-preview-page">
      <div className="caption-container">
        <header className="caption-header">
          <h1>Create</h1>

          <nav
            className="caption-navigation"
            aria-label="Main navigation"
          >
            <Link href="/create" aria-current="page">
              Create
            </Link>
            <Link href="/community">Community</Link>
            <Link href="/login">Sign In</Link>
          </nav>
        </header>

        <section className="create-preview-section">
          <h2>What&apos;s your story?</h2>
          <p className="create-preview-subtitle">
            Turn your photos and everyday moments into
            captions.
          </p>

          <div className="create-preview-card">
            <div className="create-preview-upload">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect
                  x="3"
                  y="5"
                  width="16"
                  height="16"
                  rx="2"
                />
                <circle cx="8" cy="10" r="1.5" />
                <path d="m4 18 5-5 3 3 3-3 4 4" />
                <path d="M20 2v6M17 5h6" />
              </svg>
              <span>Add a photo</span>
            </div>

            <div className="create-preview-input">
              Describe your moment...
            </div>

            <div
              className="create-preview-styles"
              aria-label="Available caption styles"
            >
              <span className="create-preview-style selected">
                Funny
              </span>
              <span className="create-preview-style">
                Witty
              </span>
              <span className="create-preview-style">
                Aesthetic
              </span>
              <span className="create-preview-style">
                Simple
              </span>
            </div>

            <Link
              href="/login"
              className="create-preview-signin"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect
                  x="5"
                  y="10"
                  width="14"
                  height="11"
                  rx="2"
                />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              Sign in to generate captions
            </Link>

            <p className="create-preview-note">
              Sign in with Google to generate, publish,
              and vote.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
