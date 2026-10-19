"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase-browser";

type Caption = {
  id: string;
  user_id: string;
  prompt: string;
  generated_caption: string;
  created_at: string;
};

type Vote = {
  caption_id: string;
  user_id: string;
  rating: number;
};

export default function CaptionApp({
  userId,
}: {
  userId: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [prompt, setPrompt] = useState("");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const loadCaptions = useCallback(async () => {
    try {
      const [captionResult, voteResult] = await Promise.all([
        supabase
          .from("captions")
          .select("id, user_id, prompt, generated_caption, created_at")
          .order("created_at", { ascending: false }),

        supabase
          .from("votes")
          .select("caption_id, user_id, rating"),
      ]);

      if (captionResult.error || voteResult.error) {
        throw new Error(
          captionResult.error?.message ||
          voteResult.error?.message ||
          "Could not load captions."
        );
      }

      setCaptions(captionResult.data ?? []);
      setVotes(voteResult.data ?? []);

      return true;
    } catch (error) {
      setIsError(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not load captions."
      );

      return false;
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadCaptions();
  }, [loadCaptions]);

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanPrompt = prompt.trim();

    if (!cleanPrompt || generating) return;

    setGenerating(true);
    setMessage("");
    setIsError(false);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: cleanPrompt }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || "Could not generate a caption."
        );
      }

      // The existing API saves the caption to Supabase.
      const loaded = await loadCaptions();

      if (loaded) {
        setPrompt("");
        setMessage("Caption generated and saved.");
      }
    } catch (error) {
      setIsError(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong."
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleVote(
    captionId: string,
    rating: 1 | -1
  ) {
    if (votingId) return;

    setVotingId(captionId);
    setMessage("");
    setIsError(false);

    try {
      const { error } = await supabase.from("votes").upsert(
        {
          caption_id: captionId,
          user_id: userId,
          rating,
        },
        {
          onConflict: "caption_id,user_id",
        }
      );

      if (error) {
        throw new Error(error.message);
      }

      await loadCaptions();
    } catch (error) {
      setIsError(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save your vote."
      );
    } finally {
      setVotingId(null);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);

    const { error } = await supabase.auth.signOut();

    if (error) {
      setIsError(true);
      setMessage(error.message);
      setSigningOut(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="caption-page">
      <div className="caption-container">

        <header className="caption-header">
          <h1>Caption Generator</h1>

          <nav className="caption-navigation">
            <Link href="/profile">My Profile</Link>

            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {signingOut ? "Signing out..." : "Sign Out"}
            </button>
          </nav>
        </header>

        <section className="caption-section">
          <h2>What&apos;s your story?</h2>

          <form onSubmit={handleGenerate}>
            <label
              htmlFor="caption-prompt"
              className="caption-label"
            >
              Describe your moment
            </label>

            <textarea
              id="caption-prompt"
              className="caption-input"
              value={prompt}
              onChange={(event) =>
                setPrompt(event.target.value)
              }
              placeholder="Tell us what happened..."
              rows={4}
              maxLength={500}
              required
              disabled={generating}
            />

            <div className="caption-form-footer">
              <span className="caption-character-count">
                {prompt.length}/500
              </span>

              <button
                type="submit"
                className="caption-generate-button"
                disabled={generating || !prompt.trim()}
              >
                {generating
                  ? "Generating..."
                  : "Generate Caption"}
              </button>
            </div>
          </form>
        </section>

        {message && (
          <p
            className={
              isError
                ? "caption-message caption-error"
                : "caption-message"
            }
            role={isError ? "alert" : "status"}
          >
            {message}
          </p>
        )}

        <section className="caption-community">
          <div className="caption-community-heading">
            <h2>Community Captions</h2>

            {!loading && (
              <span className="caption-total">
                {captions.length}{" "}
                {captions.length === 1
                  ? "caption"
                  : "captions"}
              </span>
            )}
          </div>

          {loading ? (
            <p className="caption-empty">
              Loading captions...
            </p>
          ) : captions.length === 0 ? (
            <p className="caption-empty">
              No captions yet.
            </p>
          ) : (
            <div className="caption-list">
              {captions.map((caption) => {
                const captionVotes = votes.filter(
                  (vote) =>
                    vote.caption_id === caption.id
                );

                const upvotes = captionVotes.filter(
                  (vote) => vote.rating === 1
                ).length;

                const downvotes = captionVotes.filter(
                  (vote) => vote.rating === -1
                ).length;

                const myVote = captionVotes.find(
                  (vote) => vote.user_id === userId
                )?.rating;

                return (
                  <article
                    key={caption.id}
                    className="caption-item"
                  >
                    <p className="caption-generated-text">
                      {caption.generated_caption}
                    </p>

                    <div className="caption-original">
                      <span className="caption-prompt-label">
                        Original Prompt
                      </span>

                      <p>{caption.prompt}</p>
                    </div>

                    <div
                      className="caption-votes"
                      role="group"
                      aria-label="Rate caption"
                    >
                      <button
                        type="button"
                        className={
                          myVote === 1
                            ? "caption-vote-button selected"
                            : "caption-vote-button"
                        }
                        aria-pressed={myVote === 1}
                        disabled={votingId !== null}
                        onClick={() =>
                          handleVote(caption.id, 1)
                        }
                      >
                        <span
                          className="caption-vote-arrow"
                          aria-hidden="true"
                        >
                          ↑
                        </span>
                        <span>Upvote</span>
                        <strong>{upvotes}</strong>
                      </button>

                      <button
                        type="button"
                        className={
                          myVote === -1
                            ? "caption-vote-button selected"
                            : "caption-vote-button"
                        }
                        aria-pressed={myVote === -1}
                        disabled={votingId !== null}
                        onClick={() =>
                          handleVote(caption.id, -1)
                        }
                      >
                        <span
                          className="caption-vote-arrow"
                          aria-hidden="true"
                        >
                          ↓
                        </span>
                        <span>Downvote</span>
                        <strong>{downvotes}</strong>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
