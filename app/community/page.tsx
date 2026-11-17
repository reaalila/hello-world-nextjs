import Link from "next/link";
import { Bricolage_Grotesque, DM_Sans } from "next/font/google";
import { createClient } from "@/lib/supabase-server";
import AccountMenu from "@/app/components/account-menu";
import VoteButtons from "./vote-buttons";
import SearchBar from "./search-bar";
import styles from "./community.module.css";

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

type PlacePhoto = {
  place: string;
  url: string;
  credit: string;
  license: string;
  sourceUrl: string;
  licenseUrl?: string | null;
};

type SideQuest = {
  id: string;
  title: string;
  generated_guide: string;
  created_at: string;
  photo: PlacePhoto | null;
};

type ItineraryStop = {
  number: number;
  place: string;
  details: string;
  activity: string;
};

type ParsedItinerary = {
  stops: ItineraryStop[];
};

type VoteCounts = {
  upvotes: number;
  downvotes: number;
};

type VoteCountRow = {
  sidequest_id: string;
  upvotes: number;
  downvotes: number;
};

type SortOption = "recent" | "top";

type CommunityPageProps = {
  searchParams: Promise<{
    sort?: string | string[];
    q?: string | string[];
  }>;
};

// Extract the tagline and time/budget estimate.
function getGuidePreview(
  guide: string,
  title: string
) {
  const lines = guide
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const estimate = lines.find((line) =>
    /\b\d+\s*(?:h|hr|hrs|hour|hours|min|mins|minute|minutes)\b|\$\s?\d+/i.test(
      line
    )
  );

  const description =
    lines.find(
      (line) =>
        line !== estimate &&
        line.toLowerCase() !== title.toLowerCase() &&
        !/^\d+\s*[.)]/.test(line) &&
        !/^[-•]/.test(line)
    ) ??
    "Discover a new adventure around New York City.";

  return { description, estimate };
}

// Convert a saved guide into numbered stops.
function parseItinerary(
  guide: string
): ParsedItinerary | null {
  const sections = guide
    .trim()
    .split(/\n\s*\n/)
    .map((section) => section.trim())
    .filter(Boolean);

  if (sections.length < 3) {
    return null;
  }

  const stopSections = sections.slice(2);
  const stops: ItineraryStop[] = [];

  for (const section of stopSections) {
    const lines = section
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 3) {
      return null;
    }

    const headingMatch = lines[0].match(
      /^(\d+)[.)]\s+(.+)$/
    );

    if (!headingMatch) {
      return null;
    }

    const number = Number(headingMatch[1]);
    const place = headingMatch[2].trim();
    const details = lines[1];
    const activity = lines.slice(2).join(" ");

    if (
      !Number.isInteger(number) ||
      !place ||
      !details ||
      !activity
    ) {
      return null;
    }

    stops.push({
      number,
      place,
      details,
      activity,
    });
  }

  return stops.length > 0 ? { stops } : null;
}

export default async function CommunityPage({
  searchParams,
}: CommunityPageProps) {
  const supabase = await createClient();

  // Read sorting and keyword search parameters.
  const params = await searchParams;

  const sort: SortOption =
    params.sort === "top" ? "top" : "recent";

  const query =
    typeof params.q === "string"
      ? params.q.trim().slice(0, 80)
      : "";

  // Public browsing; authentication is optional.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // STEP 1: Load published Sidequests.
  const { data, error } = await supabase
    .from("sidequests")
    .select(
      "id, title, generated_guide, created_at, photo"
    )
    .eq("is_published", true)
    .order("created_at", { ascending: false })
    .limit(200);

  const sidequests = (data ?? []) as SideQuest[];

  // STEP 2: Load aggregate vote counts.
  const voteCounts: Record<string, VoteCounts> = {};

  let countsAvailable = false;

  if (!error && sidequests.length > 0) {
    const {
      data: countRows,
      error: countsError,
    } = await supabase.rpc(
      "get_sidequest_vote_counts"
    );

    if (countsError) {
      console.error(
        "Could not load vote counts:",
        countsError
      );
    } else {
      countsAvailable = true;

      for (const row of
        (countRows ?? []) as VoteCountRow[]) {
        voteCounts[row.sidequest_id] = {
          upvotes: Number(row.upvotes) || 0,
          downvotes: Number(row.downvotes) || 0,
        };
      }
    }
  }

  // STEP 3: Load current user's votes.
  const userVotes: Record<string, 1 | -1> = {};

  if (user && sidequests.length > 0) {
    const {
      data: votes,
      error: votesError,
    } = await supabase
      .from("sidequest_votes")
      .select("sidequest_id, vote")
      .eq("user_id", user.id)
      .in(
        "sidequest_id",
        sidequests.map((sidequest) => sidequest.id)
      );

    if (votesError) {
      console.error(
        "Could not load user votes:",
        votesError
      );
    }

    for (const vote of votes ?? []) {
      if (vote.vote === 1 || vote.vote === -1) {
        userVotes[vote.sidequest_id] = vote.vote;
      }
    }
  }

  // STEP 4: Filter Sidequests by keywords.
  //
  // Match titles, taglines, locations,
  // and the complete saved itinerary text.
  const normalizedQuery = query.toLowerCase();

  const filteredSidequests = normalizedQuery
    ? sidequests.filter((sidequest) => {
        const searchableText = [
          sidequest.title,
          sidequest.generated_guide,
        ]
          .join(" ")
          .toLowerCase();

        return searchableText.includes(normalizedQuery);
      })
    : sidequests;

  // STEP 5: Sort filtered results.
  const sortedSidequests = [...filteredSidequests];

  if (sort === "top" && countsAvailable) {
    sortedSidequests.sort((a, b) => {
      const aCounts = voteCounts[a.id] ?? {
        upvotes: 0,
        downvotes: 0,
      };

      const bCounts = voteCounts[b.id] ?? {
        upvotes: 0,
        downvotes: 0,
      };

      const aScore =
        aCounts.upvotes - aCounts.downvotes;

      const bScore =
        bCounts.upvotes - bCounts.downvotes;

      if (bScore !== aScore) {
        return bScore - aScore;
      }

      // Newer Sidequests break ranking ties.
      return (
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime()
      );
    });
  }

  // Keep the search query when changing sorting.
  const encodedQuery = encodeURIComponent(query);

  const recentHref = query
    ? `/community?q=${encodedQuery}`
    : "/community";

  const topHref = query
    ? `/community?sort=top&q=${encodedQuery}`
    : "/community?sort=top";

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
                className={styles.activeNavLink}
                aria-current="page"
              >
                EXPLORE
              </Link>

              <Link
                href="/sidequest"
                className={styles.navLink}
              >
                CREATE
              </Link>

              <AccountMenu
                isLoggedIn={Boolean(user)}
              />
            </div>
          </nav>
        </header>

        {/* COMMUNITY COLLECTION */}
        <section
          className={styles.communitySection}
          aria-labelledby="community-heading"
        >
          {/* COMPACT TWO-ROW HEADER */}
          <div className={styles.collectionHeader}>
            {/* EYEBROW + SHARED COUNT */}
            <div className={styles.collectionTopRow}>
              <p className={styles.sectionEyebrow}>
                THE COMMUNITY COLLECTION ✳
              </p>

              {!error && sidequests.length > 0 && (
                <span className={styles.collectionCount}>
                  {sidequests.length} SHARED
                </span>
              )}
            </div>

            {/* TITLE + SEARCH + SORT */}
            <div className={styles.titleToolsRow}>
              <h1
                id="community-heading"
                className={styles.sectionTitle}
              >
                EXPLORE SIDEQUESTS<span>.</span>
              </h1>

              {!error && sidequests.length > 0 && (
                <div className={styles.headerTools}>
                  {/* KEYWORD SEARCH */}
                  <SearchBar
                    initialQuery={query}
                    sort={sort}
                  />

                  {/* EXISTING SORT CONTROLS */}
                  <div
                    className={styles.headerSort}
                    aria-label="Sort Sidequests"
                  >
                    <span className={styles.sortLabel}>
                      SORT BY
                    </span>

                    <div className={styles.sortOptions}>
                      <Link
                        href={recentHref}
                        className={`${styles.sortLink} ${
                          sort === "recent"
                            ? styles.sortActive
                            : ""
                        }`}
                        aria-current={
                          sort === "recent"
                            ? "page"
                            : undefined
                        }
                      >
                        MOST RECENT
                      </Link>

                      {countsAvailable ? (
                        <Link
                          href={topHref}
                          className={`${styles.sortLink} ${
                            sort === "top"
                              ? styles.sortActive
                              : ""
                          }`}
                          aria-current={
                            sort === "top"
                              ? "page"
                              : undefined
                          }
                        >
                          TOP RATED
                        </Link>
                      ) : (
                        <span
                          className={styles.sortDisabled}
                          title="Vote totals are unavailable"
                        >
                          TOP RATED
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* DATABASE ERROR */}
          {error && (
            <div
              className={styles.messageCard}
              role="alert"
            >
              Could not load published Sidequests.
              Please try again later.
            </div>
          )}

          {/* NO PUBLISHED SIDEQUESTS */}
          {!error && sidequests.length === 0 && (
            <div className={styles.messageCard}>
              <h2>NO SIDEQUESTS YET!</h2>

              <p>
                Be the first to share an adventure.
              </p>

              <Link
                href="/sidequest"
                className={styles.darkButton}
              >
                CREATE THE FIRST SIDEQUEST ↗
              </Link>
            </div>
          )}

          {/* VOTE TOTALS ERROR */}
          {!error &&
            sidequests.length > 0 &&
            !countsAvailable && (
              <p
                className={styles.countsError}
                role="status"
              >
                Vote totals are temporarily unavailable.
              </p>
            )}

          {/* NO SEARCH RESULTS */}
          {!error &&
            sidequests.length > 0 &&
            sortedSidequests.length === 0 && (
              <div className={styles.messageCard}>
                <h2>NO MATCHING SIDEQUESTS!</h2>

                <p>
                  Try a different keyword or
                  neighborhood.
                </p>

                <Link
                  href="/community"
                  className={styles.darkButton}
                >
                  CLEAR SEARCH ↗
                </Link>
              </div>
            )}

          {/* MATCHING SIDEQUESTS */}
          {!error && sortedSidequests.length > 0 && (
            <div className={styles.cards}>
              {sortedSidequests.map(
                (sidequest, index) => {
                  const photo = sidequest.photo;

                  const {
                    description,
                    estimate,
                  } = getGuidePreview(
                    sidequest.generated_guide,
                    sidequest.title
                  );

                  const itinerary = parseItinerary(
                    sidequest.generated_guide
                  );

                  const counts =
                    voteCounts[sidequest.id] ?? {
                      upvotes: 0,
                      downvotes: 0,
                    };

                  return (
                    <article
                      key={sidequest.id}
                      className={styles.card}
                    >
                      {/* PHOTOGRAPH */}
                      <div
                        className={styles.cardMedia}
                      >
                        {photo?.url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={photo.url}
                            alt={`Photograph associated with ${photo.place}`}
                            className={styles.cardImage}
                            loading="lazy"
                          />
                        ) : (
                          <div
                            className={
                              styles.photoPlaceholder
                            }
                          >
                            <span aria-hidden="true">
                              ✳
                            </span>
                            <strong>
                              NYC SIDEQUEST
                            </strong>
                            <small>
                              GO SOMEWHERE NEW
                            </small>
                          </div>
                        )}
                      </div>

                      {/* CARD CONTENT */}
                      <div
                        className={styles.cardContent}
                      >
                        <div className={styles.cardTop}>
                          <span
                            className={
                              styles.cardLabel
                            }
                          >
                            COMMUNITY SIDEQUEST
                          </span>

                          <span
                            className={
                              styles.cardNumber
                            }
                          >
                            NO.{" "}
                            {String(
                              index + 1
                            ).padStart(2, "0")}
                          </span>
                        </div>

                        {/* TITLE AND ESTIMATE */}
                        <div
                          className={styles.cardMain}
                        >
                          <div
                            className={
                              styles.cardInfoRow
                            }
                          >
                            <div
                              className={
                                styles.cardText
                              }
                            >
                              <h2
                                className={
                                  styles.cardTitle
                                }
                              >
                                {sidequest.title}
                              </h2>

                              <p
                                className={
                                  styles.cardDescription
                                }
                              >
                                {description}
                              </p>
                            </div>

                            {estimate && (
                              <div
                                className={
                                  styles.estimate
                                }
                              >
                                <span
                                  aria-hidden="true"
                                >
                                  ◷
                                </span>

                                <span>
                                  {estimate}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* ITINERARY AND VOTING */}
                        <div
                          className={
                            styles.actionsArea
                          }
                        >
                          <details
                            className={styles.details}
                          >
                            <summary
                              className={
                                styles.detailsSummary
                              }
                            >
                              <span>
                                VIEW FULL ITINERARY
                              </span>

                              <span
                                className={
                                  styles.detailsArrow
                                }
                                aria-hidden="true"
                              >
                                ↘
                              </span>
                            </summary>

                            {itinerary ? (
                              <div
                                className={
                                  styles.itineraryStops
                                }
                              >
                                {itinerary.stops.map(
                                  (
                                    stop,
                                    stopIndex
                                  ) => (
                                    <div
                                      key={`${sidequest.id}-${stopIndex}`}
                                      className={
                                        styles.itineraryStop
                                      }
                                    >
                                      <div
                                        className={
                                          styles.stopNumber
                                        }
                                        aria-hidden="true"
                                      >
                                        {stop.number}
                                      </div>

                                      <div
                                        className={
                                          styles.stopContent
                                        }
                                      >
                                        <h3
                                          className={
                                            styles.stopPlace
                                          }
                                        >
                                          {stop.place}
                                        </h3>

                                        <p
                                          className={
                                            styles.stopDetails
                                          }
                                        >
                                          {stop.details}
                                        </p>

                                        <p
                                          className={
                                            styles.stopActivity
                                          }
                                        >
                                          {stop.activity}
                                        </p>
                                      </div>
                                    </div>
                                  )
                                )}
                              </div>
                            ) : (
                              <div
                                className={
                                  styles.fullGuide
                                }
                              >
                                {
                                  sidequest.generated_guide
                                }
                              </div>
                            )}
                          </details>

                          {/* VOTING AND COUNTS */}
                          <div
                            className={
                              styles.votingArea
                            }
                          >
                            <VoteButtons
                              key={sidequest.id}
                              sidequestId={
                                sidequest.id
                              }
                              isLoggedIn={
                                Boolean(user)
                              }
                              initialVote={
                                userVotes[
                                  sidequest.id
                                ] ?? null
                              }
                              initialUpvotes={
                                counts.upvotes
                              }
                              initialDownvotes={
                                counts.downvotes
                              }
                              showCounts={
                                countsAvailable
                              }
                            />
                          </div>
                        </div>

                        {/* PHOTO ATTRIBUTION */}
                        {photo && (
                          <p
                            className={
                              styles.photoCredit
                            }
                          >
                            Photo: {photo.credit}
                            {" · "}

                            {photo.licenseUrl ? (
                              <a
                                href={
                                  photo.licenseUrl
                                }
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
                      </div>
                    </article>
                  );
                }
              )}
            </div>
          )}
        </section>

        {/* FOOTER */}
        <footer className={styles.footer}>
          <span>✳ NYC SIDEQUEST</span>
          <span>MADE FOR THE CURIOUS.</span>
        </footer>
      </div>
    </main>
  );
}
