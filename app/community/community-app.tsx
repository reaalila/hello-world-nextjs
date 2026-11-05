"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/lib/supabase-browser";

type CommunityCaption = {
  id: string;
  prompt: string;
  generated_caption: string;
  image_url: string | null;
  created_at: string;
  upvotes: number | string;
  downvotes: number | string;
};

type UserVote = {
  caption_id: string;
  rating: number;
};

type SortMode = "latest" | "top";

export default function CommunityApp({
  userId,
}: {
  userId: string | null;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [captions, setCaptions] = useState<
    CommunityCaption[]
  >([]);
  const [myVotes, setMyVotes] = useState<
    Record<string, number>
  >({});
  const [sortMode, setSortMode] =
    useState<SortMode>("latest");

  const [loading, setLoading] = useState(true);
  const [votingId, setVotingId] = useState<string | null>(
    null
  );
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");

  const loadCommunity = useCallback(async () => {
    try {
      const { data, error: feedError } =
        await supabase.rpc("get_community_feed");

      if (feedError) throw new Error(feedError.message);

      setCaptions(
        (data ?? []) as CommunityCaption[]
      );

      if (userId) {
        const { data: votes, error: voteError } =
          await supabase
            .from("votes")
            .select("caption_id, rating")
            .eq("user_id", userId);

        if (voteError) {
          throw new Error(voteError.message);
        }

        const selectedVotes: Record<string, number> = {};

        for (const vote of (votes ?? []) as UserVote[]) {
          selectedVotes[vote.caption_id] = vote.rating;
        }

        setMyVotes(selectedVotes);
      } else {
        setMyVotes({});
      }

      setError("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not load community captions."
      );
    } finally {
      setLoading(false);
    }
  }, [supabase, userId]);

  useEffect(() => {
    void loadCommunity();
  }, [loadCommunity]);

  const sortedCaptions = useMemo(() => {
    const sorted = [...captions];

    if (sortMode === "top") {
      sorted.sort((a, b) => {
        const scoreA =
          Number(a.upvotes) - Number(a.downvotes);

        const scoreB =
          Number(b.upvotes) - Number(b.downvotes);

        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }

        return (
          new Date(b.created_at).getTime() -
          new Date(a.created_at).getTime()
        );
      });
    } else {
      sorted.sort(
        (a, b) =>
          new Date(b.created_at).getTime() -
          new Date(a.created_at).getTime()
      );
    }

    return sorted;
  }, [captions, sortMode]);

  async function handleVote(
    captionId: string,
    rating: 1 | -1
  ) {
    if (!userId) {
      router.push("/login");
      return;
    }

    if (votingId) return;

    setVotingId(captionId);
    setError("");

    try {
      const { error: voteError } = await supabase
        .from("votes")
        .upsert(
          {
            caption_id: captionId,
            user_id: userId,
            rating,
          },
          {
            onConflict: "caption_id,user_id",
          }
        );

      if (voteError) {
        throw new Error(voteError.message);
      }

      await loadCommunity();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save your vote."
      );
    } finally {
      setVotingId(null);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);

    const { error: signOutError } =
      await supabase.auth.signOut();

    if (signOutError) {
      setError(signOutError.message);
      setSigningOut(false);
      return;
    }

    router.replace("/community");
    router.refresh();
  }

  return (
    <main className="caption-page community-page">
      <div className="caption-container">
        <header className="caption-header">
          <h1>Community</h1>

          <nav
            className="caption-navigation"
            aria-label="Main navigation"
          >
            <Link href="/create">Create</Link>

            <Link
              href="/community"
              aria-current="page"
            >
              Community
            </Link>

            {userId ? (
              <>
                <Link href="/profile">My Profile</Link>

                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={signingOut}
                >
                  {signingOut
                    ? "Signing out..."
                    : "Sign Out"}
                </button>
              </>
            ) : (
              <Link href="/login">Sign In</Link>
            )}
          </nav>
        </header>

        <section id="community" className="caption-community">
          <div className="caption-community-heading">
            <div className="community-heading-text">
              <h2>Explore captions</h2>

              <p className="community-description">
                Discover what others have created.
              </p>
            </div>

            <div className="caption-community-controls">
              {!loading && (
                <span className="caption-total">
                  {captions.length}{" "}
                  {captions.length === 1
                    ? "caption"
                    : "captions"}
                </span>
              )}

              <div
                className="caption-sort-controls"
                role="group"
                aria-label="Sort community captions"
              >
                <button
                  type="button"
                  className={
                    sortMode === "latest"
                      ? "caption-sort-button selected"
                      : "caption-sort-button"
                  }
                  aria-pressed={sortMode === "latest"}
                  onClick={() => setSortMode("latest")}
                >
                  Latest
                </button>

                <button
                  type="button"
                  className={
                    sortMode === "top"
                      ? "caption-sort-button selected"
                      : "caption-sort-button"
                  }
                  aria-pressed={sortMode === "top"}
                  onClick={() => setSortMode("top")}
                >
                  Top Rated
                </button>
              </div>
            </div>
          </div>

          {!userId && (
            <p className="community-guest-note">
              Enjoy browsing! Sign in when you're
              ready to create captions or vote.
            </p>
          )}

          {error && (
            <p
              className="caption-message caption-error"
              role="alert"
            >
              {error}
            </p>
          )}

          {loading ? (
            <p className="caption-empty">
              Loading captions...
            </p>
          ) : sortedCaptions.length === 0 ? (
            <p className="caption-empty">
              No captions yet.
            </p>
          ) : (
            <div className="caption-list">
              {sortedCaptions.map((caption) => {
                const myVote = myVotes[caption.id];

                return (
                  <article
                    key={caption.id}
                    className="caption-item"
                  >
                    {caption.image_url && (
                      <img
                        src={caption.image_url}
                        alt="Photo accompanying the caption"
                        className="caption-card-image"
                        loading="lazy"
                      />
                    )}

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
                        aria-pressed={
                          userId ? myVote === 1 : undefined
                        }
                        disabled={votingId !== null}
                        onClick={() =>
                          handleVote(caption.id, 1)
                        }
                        title={
                          userId
                            ? "Upvote"
                            : "Sign in to vote"
                        }
                      >
                        <span
                          className="caption-vote-arrow"
                          aria-hidden="true"
                        >
                          ↑
                        </span>
                        Upvote
                        <strong>
                          {Number(caption.upvotes)}
                        </strong>
                      </button>

                      <button
                        type="button"
                        className={
                          myVote === -1
                            ? "caption-vote-button selected"
                            : "caption-vote-button"
                        }
                        aria-pressed={
                          userId ? myVote === -1 : undefined
                        }
                        disabled={votingId !== null}
                        onClick={() =>
                          handleVote(caption.id, -1)
                        }
                        title={
                          userId
                            ? "Downvote"
                            : "Sign in to vote"
                        }
                      >
                        <span
                          className="caption-vote-arrow"
                          aria-hidden="true"
                        >
                          ↓
                        </span>
                        Downvote
                        <strong>
                          {Number(caption.downvotes)}
                        </strong>
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
