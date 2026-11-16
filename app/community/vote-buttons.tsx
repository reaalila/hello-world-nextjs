"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./vote-buttons.module.css";

type VoteValue = 1 | -1;

type VoteButtonsProps = {
  sidequestId: string;
  isLoggedIn: boolean;
  initialVote: VoteValue | null;
};

export default function VoteButtons({
  sidequestId,
  isLoggedIn,
  initialVote,
}: VoteButtonsProps) {
  const [selectedVote, setSelectedVote] =
    useState<VoteValue | null>(initialVote);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function saveVote(vote: VoteValue) {
    if (loading || !isLoggedIn) return;

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

      if (!response.ok || data.success !== true) {
        throw new Error(
          data.error || "Could not save your vote."
        );
      }

      setSelectedVote(vote);
      setSaved(true);
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

  if (!isLoggedIn) {
    return (
      <Link
        href="/login"
        className={styles.signInLink}
      >
        SIGN IN TO VOTE ↗
      </Link>
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
        >
          <span aria-hidden="true">👍</span>
          Upvote
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
        >
          <span aria-hidden="true">👎</span>
          Downvote
        </button>
      </div>

      {loading && (
        <p className={styles.status} role="status">
          Saving your vote...
        </p>
      )}

      {saved && !loading && (
        <p className={styles.success} role="status">
          ✓ Vote saved
        </p>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
