"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Bricolage_Grotesque, DM_Sans } from "next/font/google";
import AccountMenu from "@/app/components/account-menu";
import styles from "./sidequest.module.css";

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

type SideQuest = {
  id: string;
  title: string;
  guide: string;
  photoPlace?: string;
  photoPlaces?: string[];
  eventIds?: number[];
};

type PlacePhoto = {
  place: string;
  url: string;
  credit: string;
  license: string;
  sourceUrl: string;
  licenseUrl?: string | null;
};

const promptIdeas = [
  {
    label: "COFFEE + BOOKS",
    prompt:
      "Plan a cozy 3-hour afternoon in Greenwich Village with independent bookstores and coffee shops. Budget under $25.",
  },
  {
    label: "FOOD ADVENTURE",
    prompt:
      "Create a 2-hour Chinatown food adventure with affordable places to eat and interesting stops. Budget under $25.",
  },
  {
    label: "SCENIC WALK",
    prompt:
      "Plan a relaxing 2-hour walk around DUMBO with waterfront views and photogenic places. Budget under $15.",
  },
];

export default function SideQuestClient() {
  const [request, setRequest] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [result, setResult] = useState<SideQuest | null>(
    null
  );

  const [photo, setPhoto] = useState<PlacePhoto | null>(
    null
  );

  const [photoLoading, setPhotoLoading] = useState(false);

  const [photoSaveError, setPhotoSaveError] = useState("");

  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [publishError, setPublishError] = useState("");

  const requestId = useRef(0);

  // --------------------------------------------
  // FIND AND SAVE A SIDEQUEST PHOTO
  // --------------------------------------------

  async function findSideQuestPhoto(
    sidequest: SideQuest,
    currentRequestId: number
  ) {
    const places =
      sidequest.photoPlaces?.length
        ? sidequest.photoPlaces
        : sidequest.photoPlace
          ? [sidequest.photoPlace]
          : [];

    const uniquePlaces = [...new Set(places)];

    if (uniquePlaces.length === 0) {
      return;
    }

    setPhotoLoading(true);
    setPhotoSaveError("");

    try {
      for (const place of uniquePlaces) {
        // Stop if the user generated another Sidequest.
        if (requestId.current !== currentRequestId) {
          return;
        }

        try {
          // STEP 1: Find a real photograph.
          const response = await fetch(
            "/api/sidequest/photo?place=" +
              encodeURIComponent(place)
          );

          if (!response.ok) {
            continue;
          }

          const data = await response.json();

          if (data.photo) {
            if (requestId.current !== currentRequestId) {
              return;
            }

            const selectedPhoto =
              data.photo as PlacePhoto;

            // STEP 2: Display the photograph immediately.
            setPhoto(selectedPhoto);

            // STEP 3: Save the photograph to Supabase,
            // even when the Sidequest is unpublished.
            try {
              const saveResponse = await fetch(
                "/api/sidequest/photo/save",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    sidequestId: sidequest.id,
                    photo: selectedPhoto,
                  }),
                }
              );

              if (!saveResponse.ok) {
                const saveError =
                  await saveResponse.json().catch(() => null);

                console.error(
                  "Sidequest photo was displayed but not saved:",
                  saveError?.error ||
                    `HTTP ${saveResponse.status}`
                );

                if (
                  requestId.current === currentRequestId
                ) {
                  setPhotoSaveError(
                    "The photograph is visible, but it could not be saved yet."
                  );
                }
              } else {
                const saveData = await saveResponse.json();

                if (saveData.success !== true) {
                  console.error(
                    "Photo save was not confirmed:",
                    saveData
                  );

                  if (
                    requestId.current === currentRequestId
                  ) {
                    setPhotoSaveError(
                      "The photograph is visible, but saving was not confirmed."
                    );
                  }
                } else if (
                  requestId.current === currentRequestId
                ) {
                  setPhotoSaveError("");
                }
              }
            } catch (saveError) {
              console.error(
                "Unable to persist Sidequest photo:",
                saveError
              );

              if (
                requestId.current === currentRequestId
              ) {
                setPhotoSaveError(
                  "The photograph is visible, but it could not be saved yet."
                );
              }
            }

            // We found a photo, so stop trying other places.
            return;
          }
        } catch (photoError) {
          console.error(
            `Photo lookup failed for ${place}:`,
            photoError
          );
        }
      }
    } finally {
      if (requestId.current === currentRequestId) {
        setPhotoLoading(false);
      }
    }
  }

  // --------------------------------------------
  // GENERATE AN AI-POWERED SIDEQUEST
  // --------------------------------------------

  async function generateSideQuest() {
    if (loading || publishing) {
      return;
    }

    const trimmedRequest = request.trim();

    if (trimmedRequest.length < 10) {
      setError(
        "Please describe your outing in more detail."
      );
      return;
    }

    const currentRequestId = ++requestId.current;

    setLoading(true);
    setError("");
    setResult(null);
    setPhoto(null);
    setPhotoLoading(false);
    setPhotoSaveError("");

    setPublished(false);
    setPublishing(false);
    setPublishError("");

    try {
      const response = await fetch(
        "/api/sidequest/generate",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            request: trimmedRequest,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not generate a SideQuest."
        );
      }

      const sidequest = data.sidequest as SideQuest;

      if (requestId.current !== currentRequestId) {
        return;
      }

      // Display the itinerary immediately.
      setResult(sidequest);

      // Find and save its photograph separately.
      void findSideQuestPhoto(
        sidequest,
        currentRequestId
      );
    } catch (err) {
      if (requestId.current === currentRequestId) {
        setError(
          err instanceof Error
            ? err.message
            : "Something went wrong."
        );
      }
    } finally {
      if (requestId.current === currentRequestId) {
        setLoading(false);
      }
    }
  }

  // --------------------------------------------
  // PUBLISH A GENERATED SIDEQUEST
  // --------------------------------------------

  async function publishSideQuest() {
    if (
      !result ||
      publishing ||
      published ||
      photoLoading
    ) {
      return;
    }

    setPublishing(true);
    setPublishError("");

    try {
      const response = await fetch(
        "/api/sidequest/publish",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sidequestId: result.id,
            photo: photo ?? null,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not publish your SideQuest."
        );
      }

      if (
        data.success !== true ||
        data.sidequest?.is_published !== true
      ) {
        throw new Error(
          "Publishing could not be confirmed."
        );
      }

      setPublished(true);
      setPhotoSaveError("");
    } catch (err) {
      setPublishError(
        err instanceof Error
          ? err.message
          : "Could not publish your SideQuest."
      );
    } finally {
      setPublishing(false);
    }
  }

  // --------------------------------------------
  // PAGE
  // --------------------------------------------

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

              {/* PROFILE ICON DROPDOWN */}
              <AccountMenu isLoggedIn={true} />
            </div>
          </nav>
        </header>

        {/* GENERATION FORM */}
        <section
          className={styles.createCard}
          aria-labelledby="create-heading"
        >
          <div className={styles.formHeading}>
            <div>
              <p className={styles.formEyebrow}>
                YOUR NEXT SIDEQUEST
              </p>

              <h2
                id="create-heading"
                className={styles.formTitle}
              >
                What would you like to explore?
              </h2>

              <p className={styles.formDescription}>
                A neighborhood, a budget, a few hours
                to spare — give us the details.
              </p>
            </div>

            <span
              className={styles.formFlower}
              aria-hidden="true"
            >
              ✳
            </span>
          </div>

          <label
            htmlFor="sidequest-request"
            className={styles.fieldLabel}
          >
            DESCRIBE YOUR IDEAL OUTING
          </label>

          <textarea
            id="sidequest-request"
            className={styles.promptInput}
            value={request}
            onChange={(event) =>
              setRequest(event.target.value)
            }
            maxLength={500}
            rows={4}
            placeholder="A cozy afternoon in Brooklyn, 3 hours free, under $25, with bookstores and coffee..."
          />

          <div className={styles.promptMeta}>
            <span>
              TIP: INCLUDE YOUR TIME, BUDGET, AND
              INTERESTS.
            </span>
            <span>{request.length}/500</span>
          </div>

          {/* EXAMPLE PROMPTS */}
          <div className={styles.ideasRow}>
            <span className={styles.ideasLabel}>
              NEED INSPO?
            </span>

            {promptIdeas.map((idea) => (
              <button
                key={idea.label}
                type="button"
                className={styles.ideaButton}
                onClick={() => setRequest(idea.prompt)}
                disabled={loading || publishing}
              >
                {idea.label} ↗
              </button>
            ))}
          </div>

          <div className={styles.formFooter}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={generateSideQuest}
              disabled={
                loading ||
                publishing ||
                request.trim().length < 10
              }
            >
              {loading
                ? "CREATING YOUR SIDEQUEST..."
                : "GENERATE MY SIDEQUEST ↗"}
            </button>

            <span className={styles.formNote}>
              A LITTLE ADVENTURE, MADE FOR YOU.
            </span>
          </div>

          {error && (
            <p
              role="alert"
              className={styles.errorMessage}
            >
              {error}
            </p>
          )}
        </section>

        {/* GENERATED ITINERARY */}
        {result && (
          <section className={styles.resultSection}>
            <div className={styles.resultHeader}>
              <div>
                <p className={styles.eyebrow}>
                  FRESHLY GENERATED
                </p>

                <h2 className={styles.resultHeading}>
                  YOUR NEW SIDEQUEST<span>.</span>
                </h2>
              </div>

              <span className={styles.resultBadge}>
                {published
                  ? "✳ PUBLISHED"
                  : "✳ YOUR DRAFT"}
              </span>
            </div>

            <div className={styles.resultCard}>

              {/* REAL LOCATION PHOTO */}
              <div className={styles.visualColumn}>
                {photo ? (
                  <div className={styles.photoFrame}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.url}
                      alt={`Photograph associated with ${photo.place}`}
                      className={styles.placeImage}
                    />
                  </div>
                ) : (
                  <div className={styles.photoPlaceholder}>
                    <span aria-hidden="true">✳</span>
                    <strong>NYC SIDEQUEST</strong>
                    <small>
                      {photoLoading
                        ? "FINDING A REAL PHOTO..."
                        : "GO SOMEWHERE NEW."}
                    </small>
                  </div>
                )}

                {/* PHOTO ATTRIBUTION */}
                {photo && (
                  <p className={styles.photoCredit}>
                    Photo: {photo.credit}
                    {" · "}

                    {photo.licenseUrl ? (
                      <a
                        href={photo.licenseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {photo.license}
                      </a>
                    ) : (
                      photo.license
                    )}

                    {" · "}

                    <a
                      href={photo.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Source
                    </a>

                    {" · Cropped for display"}
                  </p>
                )}

                {/* PHOTO SAVE ERROR */}
                {photoSaveError && !published && (
                  <p
                    role="alert"
                    className={styles.errorMessage}
                  >
                    {photoSaveError}
                  </p>
                )}
              </div>

              {/* GENERATED GUIDE */}
              <div className={styles.guideColumn}>
                <p className={styles.guideLabel}>
                  YOUR PERSONAL NYC ADVENTURE
                </p>

                <h3 className={styles.resultTitle}>
                  {result.title}
                </h3>

                <div className={styles.guideSections}>
                  {result.guide
                    .split(/\n\s*\n/)
                    .filter(Boolean)
                    .map((section, index) => {
                      const isStop =
                        /^\s*(?:\d+[.)]|STOP\s+\d+)/i.test(
                          section
                        );

                      return (
                        <div
                          key={index}
                          className={
                            isStop
                              ? styles.guideStop
                              : styles.guideParagraph
                          }
                        >
                          {section}
                        </div>
                      );
                    })}
                </div>

                {/* PUBLISHING */}
                <div className={styles.publishArea}>
                  {!published ? (
                    <>
                      <p className={styles.publishPrompt}>
                        LIKE YOUR PLAN? SHARE IT WITH
                        THE COMMUNITY.
                      </p>

                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={publishSideQuest}
                        disabled={
                          publishing ||
                          photoLoading ||
                          loading
                        }
                      >
                        {publishing
                          ? "PUBLISHING..."
                          : photoLoading
                            ? "CHECKING PHOTOGRAPH..."
                            : "PUBLISH TO COMMUNITY ↗"}
                      </button>

                      {publishError && (
                        <p
                          role="alert"
                          className={styles.errorMessage}
                        >
                          {publishError}
                        </p>
                      )}
                    </>
                  ) : (
                    <div
                      className={styles.successMessage}
                      role="status"
                    >
                      <span>
                        ✓ YOUR SIDEQUEST IS PUBLISHED!
                      </span>

                      <Link
                        href="/community"
                        className={styles.communityButton}
                      >
                        SEE IT IN COMMUNITY ↗
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* FOOTER */}
        <footer className={styles.footer}>
          <span>✳ NYC SIDEQUEST</span>
          <span>MADE FOR THE CURIOUS.</span>
        </footer>
      </div>
    </main>
  );
}
