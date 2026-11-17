"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./vote-buttons.module.css";

type VoteValue = 1 | -1;

type VoteButtonsProps = {
  sidequestId: string;
  isLoggedIn: boolean;
  initialVote: VoteValue | null;
  initialUpvotes: number;
  initialDownvotes: number;
  showCounts?: boolean;
};

export default function VoteButtons({
  sidequestId,
  isLoggedIn,
  initialVote,
  initialUpvotes,
  initialDownvotes,
  showCounts = true,
}: VoteButtonsProps) {
  const router = useRouter();

  const [selectedVote, setSelectedVote] =
    useState<VoteValue | null>(initialVote);

  const [upvotes, setUpvotes] = useState(
    initialUpvotes
  );

  const [downvotes, setDownvotes] = useState(
    initialDownvotes
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function saveVote(vote: VoteValue) {
    if (loading || !isLoggedIn) {
      return;
    }

    setLoading(true);
    setError("");
    setSaved(false);

    try {
      const response = await fetch(
        "/api/sidequest/vote",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sidequestId,
            vote,
          }),
        }
      );

      const data = await response.json();

      if (
        !response.ok ||
        data.success !== true ||
        data.vote !== vote
      ) {
        throw new Error(
          data.error ||
            "Could not save your vote."
        );
      }

      // Update counts only when the
      // selected vote actually changes.
      if (selectedVote !== vote) {
        if (selectedVote === 1) {
          setUpvotes((current) =>
            Math.max(0, current - 1)
          );
        }

        if (selectedVote === -1) {
          setDownvotes((current) =>
            Math.max(0, current - 1)
          );
        }

        if (vote === 1) {
          setUpvotes((current) => current + 1);
        }

        if (vote === -1) {
          setDownvotes((current) => current + 1);
        }
      }

      setSelectedVote(vote);
      setSaved(true);

      // Refresh server data so Top Rated
      // ordering reflects the saved vote.
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  // Public visitors can see the totals,
  // but cannot vote without signing in.
  if (!isLoggedIn) {
    return (
      <div className={styles.container}>
        <div className={styles.buttons}>
          {showCounts && (
            <span
              className={styles.publicCounts}
              aria-label={`${upvotes} upvotes and ${downvotes} downvotes`}
            >
              👍 {upvotes} · 👎 {downvotes}
            </span>
          )}

          <Link
            href="/login"
            className={styles.signInLink}
          >
            SIGN IN TO VOTE ↗
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div
        className={styles.buttons}
        role="group"
        aria-label="Rate this SideQuest"
      >
        <button
          type="button"
          className={`${styles.voteButton} ${
            selectedVote === 1
              ? styles.upActive
              : ""
          }`}
          onClick={() => void saveVote(1)}
          disabled={loading}
          aria-pressed={selectedVote === 1}
          aria-label={
            showCounts
              ? `Upvote this SideQuest. ${upvotes} upvotes.`
              : "Upvote this SideQuest."
          }
        >
          <span aria-hidden="true">👍</span>
          <span>Upvote</span>

          {showCounts && (
            <span
              className={styles.voteCount}
              aria-hidden="true"
            >
              {upvotes}
            </span>
          )}
        </button>

        <button
          type="button"
          className={`${styles.voteButton} ${
            selectedVote === -1
              ? styles.downActive
              : ""
          }`}
          onClick={() => void saveVote(-1)}
          disabled={loading}
          aria-pressed={selectedVote === -1}
          aria-label={
            showCounts
              ? `Downvote this SideQuest. ${downvotes} downvotes.`
              : "Downvote this SideQuest."
          }
        >
          <span aria-hidden="true">👎</span>
          <span>Downvote</span>

          {showCounts && (
            <span
              className={styles.voteCount}
              aria-hidden="true"
            >
              {downvotes}
            </span>
          )}
        </button>
      </div>

      {loading && (
        <p
          className={styles.status}
          role="status"
        >
          Saving your vote...
        </p>
      )}

      {saved && !loading && (
        <p
          className={styles.success}
          role="status"
        >
          ✓ Vote saved
        </p>
      )}

      {error && (
        <p
          className={styles.error}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
