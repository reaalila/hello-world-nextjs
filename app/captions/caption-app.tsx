"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, FormEvent } from "react";
import { createClient } from "@/lib/supabase-browser";

type Caption = {
  id: string;
  user_id: string;
  prompt: string;
  generated_caption: string;
  created_at: string;
  image_url: string | null;
};

type Vote = {
  caption_id: string;
  user_id: string;
  rating: number;
};

type Style = "Funny" | "Witty" | "Aesthetic" | "Simple";
type SortMode = "latest" | "top";

type Draft = {
  captions: string[];
  prompt: string;
  imagePath: string | null;
  style: Style;
};

const STYLES: Style[] = [
  "Funny",
  "Witty",
  "Aesthetic",
  "Simple",
];

const PHOTO_BUCKET = "caption-images";
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

export default function CaptionApp({
  userId,
}: {
  userId: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("Funny");
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    null
  );

  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [captions, setCaptions] = useState<Caption[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("latest");

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (!photo) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(photo);
    setPreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [photo]);

  const loadCaptions = useCallback(async () => {
    try {
      const [captionResult, voteResult] = await Promise.all([
        supabase
          .from("captions")
          .select(
            "id, user_id, prompt, generated_caption, created_at, image_url"
          )
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

  const sortedCaptions = useMemo(() => {
    const items = [...captions];

    if (sortMode === "top") {
      const scores = new Map<string, number>();

      for (const vote of votes) {
        scores.set(
          vote.caption_id,
          (scores.get(vote.caption_id) ?? 0) + vote.rating
        );
      }

      items.sort((a, b) => {
        const scoreDifference =
          (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);

        if (scoreDifference !== 0) {
          return scoreDifference;
        }

        return (
          new Date(b.created_at).getTime() -
          new Date(a.created_at).getTime()
        );
      });
    } else {
      items.sort(
        (a, b) =>
          new Date(b.created_at).getTime() -
          new Date(a.created_at).getTime()
      );
    }

    return items;
  }, [captions, votes, sortMode]);

  function handlePhotoChange(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const selectedFile = event.target.files?.[0];
    event.target.value = "";

    if (!selectedFile) return;

    setMessage("");
    setIsError(false);

    if (!ALLOWED_TYPES.includes(selectedFile.type)) {
      setIsError(true);
      setMessage("Choose a JPG, PNG, or WebP photo.");
      return;
    }

    if (selectedFile.size > MAX_PHOTO_SIZE) {
      setIsError(true);
      setMessage("Choose a photo smaller than 5 MB.");
      return;
    }

    setPhoto(selectedFile);
  }

  async function handleGenerate(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const cleanPrompt = prompt.trim();

    if (
      generating ||
      draft ||
      (!cleanPrompt && !photo)
    ) {
      return;
    }

    setGenerating(true);
    setMessage("");
    setIsError(false);

    let uploadedPath: string | null = null;

    try {
      if (photo) {
        const extension =
          photo.type === "image/png"
            ? "png"
            : photo.type === "image/webp"
              ? "webp"
              : "jpg";

        uploadedPath =
          `${userId}/${crypto.randomUUID()}.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(uploadedPath, photo, {
            contentType: photo.type,
            upsert: false,
          });

        if (uploadError) {
          throw new Error(
            `Could not upload photo: ${uploadError.message}`
          );
        }
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: cleanPrompt,
          imagePath: uploadedPath,
          style,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || "Could not generate captions."
        );
      }

      if (
        !Array.isArray(result.captions) ||
        result.captions.length !== 3 ||
        !result.captions.every(
          (item: unknown) =>
            typeof item === "string" && item.trim().length > 0
        )
      ) {
        throw new Error(
          "The AI did not return three caption options."
        );
      }

      setDraft({
        captions: result.captions,
        prompt: cleanPrompt,
        imagePath: uploadedPath,
        style,
      });

      setSelectedIndex(0);
    } catch (error) {
      if (uploadedPath) {
        const { error: cleanupError } =
          await supabase.storage
            .from(PHOTO_BUCKET)
            .remove([uploadedPath]);

        if (cleanupError) {
          console.error(
            "Photo cleanup failed:",
            cleanupError
          );
        }
      }

      setIsError(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not generate captions."
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopyCaption() {
    if (!draft) return;

    try {
      await navigator.clipboard.writeText(
        draft.captions[selectedIndex]
      );

      setIsError(false);
      setMessage("Caption copied to clipboard.");
    } catch {
      setIsError(true);
      setMessage("Could not copy the caption.");
    }
  }

  async function handlePublish() {
    if (!draft || publishing) return;

    setPublishing(true);
    setMessage("");
    setIsError(false);

    try {
      const selectedCaption = draft.captions[selectedIndex];

      let imageUrl: string | null = null;

      if (draft.imagePath) {
        const { data } = supabase.storage
          .from(PHOTO_BUCKET)
          .getPublicUrl(draft.imagePath);

        imageUrl = data.publicUrl;
      }

      const originalPrompt =
        draft.prompt || "Caption this uploaded photo.";

      const { error } = await supabase
        .from("captions")
        .insert({
          user_id: userId,
          prompt: `${originalPrompt} (Style: ${draft.style})`,
          generated_caption: selectedCaption,
          image_url: imageUrl,
        });

      if (error) {
        throw new Error(error.message);
      }

      // Clear the draft only after Supabase confirms saving.
      setDraft(null);
      setSelectedIndex(0);
      setPrompt("");
      setPhoto(null);
      setStyle("Funny");
      setSortMode("latest");

      const loaded = await loadCaptions();

      if (loaded) {
        setMessage("Caption published to the community.");
        setIsError(false);
      }
    } catch (error) {
      setIsError(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not publish your caption."
      );
    } finally {
      setPublishing(false);
    }
  }

  async function handleStartOver() {
    if (!draft || discarding) return;

    setDiscarding(true);
    setMessage("");
    setIsError(false);

    try {
      if (draft.imagePath) {
        const { error } = await supabase.storage
          .from(PHOTO_BUCKET)
          .remove([draft.imagePath]);

        if (error) {
          throw new Error(
            `Could not remove unused photo: ${error.message}`
          );
        }
      }

      setDraft(null);
      setSelectedIndex(0);
      // Preserve the current description, style, and chosen photo.
    } catch (error) {
      setIsError(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not reset the caption options."
      );
    } finally {
      setDiscarding(false);
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

    router.replace("/community");
    router.refresh();
  }

  return (
    <main className="caption-page create-page">
      <div className="caption-container">
        <header className="caption-header">
          <h1>Create</h1>

          <nav className="caption-navigation">
            <Link href="#community">Community</Link>
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

        <section id="create" className="caption-section">
          <h2>What&apos;s your story?</h2>

          <form onSubmit={handleGenerate}>
            <label className="caption-label">
              Add a photo
              <span className="caption-optional">
                {" "}(optional)
              </span>
            </label>

            <input
              ref={photoInputRef}
              className="caption-file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handlePhotoChange}
              disabled={generating || Boolean(draft)}
              aria-label="Choose a photo to caption"
            />

            {photo && previewUrl ? (
              <div className="caption-photo-preview">
                <img
                  src={previewUrl}
                  alt="Photo selected for caption generation"
                />

                <div className="caption-photo-actions">
                  <span className="caption-photo-filename">
                    {photo.name}
                  </span>

                  <div className="caption-photo-buttons">
                    <button
                      type="button"
                      className="caption-photo-button"
                      onClick={() =>
                        photoInputRef.current?.click()
                      }
                      disabled={generating || Boolean(draft)}
                    >
                      Change Photo
                    </button>

                    <button
                      type="button"
                      className="caption-remove-photo"
                      onClick={() => setPhoto(null)}
                      disabled={generating || Boolean(draft)}
                    >
                      Remove Photo
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="caption-photo-button"
                onClick={() =>
                  photoInputRef.current?.click()
                }
                disabled={generating || Boolean(draft)}
              >
                + Choose Photo
              </button>
            )}

            <label
              htmlFor="caption-prompt"
              className="caption-label caption-text-label"
            >
              Describe your moment
              <span className="caption-optional">
                {" "}(optional with a photo)
              </span>
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
              disabled={generating || Boolean(draft)}
            />

            <div className="caption-style-section">
              <span className="caption-label">
                Caption style
              </span>

              <div
                className="caption-style-options"
                role="group"
                aria-label="Caption style"
              >
                {STYLES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={
                      style === option
                        ? "caption-style-button selected"
                        : "caption-style-button"
                    }
                    aria-pressed={style === option}
                    onClick={() => setStyle(option)}
                    disabled={generating || Boolean(draft)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="caption-form-footer">
              <span className="caption-character-count">
                {prompt.length}/500
              </span>

              <button
                type="submit"
                className="caption-generate-button"
                disabled={
                  generating ||
                  Boolean(draft) ||
                  (!prompt.trim() && !photo)
                }
              >
                {generating
                  ? "Generating..."
                  : "Generate 3 Captions"}
              </button>
            </div>

            {generating && (
              <p className="caption-processing" role="status">
                Generating your options. Keep this page open.
              </p>
            )}
          </form>
        </section>

        {draft && (
          <section className="caption-choices">
            <div className="caption-choices-heading">
              <h2>Choose your favorite</h2>
              <span className="caption-choices-style">
                {draft.style}
              </span>
            </div>

            <div
              className="caption-options-list"
              role="radiogroup"
              aria-label="Generated caption options"
            >
              {draft.captions.map((option, index) => (
                <button
                  key={index}
                  type="button"
                  role="radio"
                  aria-checked={selectedIndex === index}
                  className={
                    selectedIndex === index
                      ? "caption-option selected"
                      : "caption-option"
                  }
                  onClick={() => setSelectedIndex(index)}
                  disabled={publishing || discarding}
                >
                  <span className="caption-option-indicator">
                    {selectedIndex === index ? "●" : "○"}
                  </span>

                  <span>{option}</span>
                </button>
              ))}
            </div>

            <div className="caption-choice-footer">
              <button
                type="button"
                className="caption-start-over"
                onClick={handleStartOver}
                disabled={publishing || discarding}
              >
                {discarding ? "Resetting..." : "Try Again"}
              </button>

              <div className="caption-choice-actions">
                <button
                  type="button"
                  className="caption-copy-button"
                  onClick={handleCopyCaption}
                  disabled={publishing || discarding}
                >
                  Copy Caption
                </button>

                <button
                  type="button"
                  className="caption-publish-button"
                  onClick={handlePublish}
                  disabled={publishing || discarding}
                >
                  {publishing
                    ? "Publishing..."
                    : "Publish Caption"}
                </button>
              </div>
            </div>
          </section>
        )}

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

        <section id="community" className="caption-community">
          <div className="caption-community-heading">
            <h2>Community Captions</h2>

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
              {sortedCaptions.map((caption) => {
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
                    {caption.image_url && (
                      <img
                        src={caption.image_url}
                        alt="Photo submitted with this caption"
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
