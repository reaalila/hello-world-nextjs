import Link from "next/link";
import { Bricolage_Grotesque, DM_Sans } from "next/font/google";
import { createClient } from "@/lib/supabase-server";
import VoteButtons from "./vote-buttons";
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

// Extract a short preview without changing stored AI content.
function getGuidePreview(guide: string, title: string) {
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
    ) ?? "Discover a new adventure around New York City.";

  return { description, estimate };
}

export default async function CommunityPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Publicly published SideQuests.
  const { data, error } = await supabase
    .from("sidequests")
    .select("id, title, generated_guide, created_at, photo")
    .eq("is_published", true)
    .order("created_at", { ascending: false })
    .limit(30);

  const sidequests = (data ?? []) as SideQuest[];

  // Retrieve only the signed-in user's votes.
  const userVotes: Record<string, 1 | -1> = {};

  if (user && sidequests.length > 0) {
    const { data: votes, error: votesError } = await supabase
      .from("sidequest_votes")
      .select("sidequest_id, vote")
      .eq("user_id", user.id)
      .in(
        "sidequest_id",
        sidequests.map((sidequest) => sidequest.id)
      );

    if (votesError) {
      console.error("Could not load user votes:", votesError);
    }

    for (const vote of votes ?? []) {
      if (vote.vote === 1 || vote.vote === -1) {
        userVotes[vote.sidequest_id] = vote.vote;
      }
    }
  }

  return (
    <main
      className={`${headingFont.variable} ${bodyFont.variable} ${styles.page}`}
    >
      <div className={styles.shell}>
        {/* NAVIGATION */}
        <header className={styles.siteHeader}>
          <nav className={styles.nav} aria-label="Main navigation">
            <Link href="/community" className={styles.logo}>
              <span className={styles.logoStar} aria-hidden="true">
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

              <Link href="/sidequest" className={styles.navLink}>
                CREATE
              </Link>

              {user ? (
                <Link href="/profile" className={styles.accountLink}>
                  MY PROFILE
                </Link>
              ) : (
                <Link href="/login" className={styles.accountLink}>
                  SIGN IN ↗
                </Link>
              )}
            </div>
          </nav>
        </header>

        {/* HERO SECTION */}
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              ✳ SMALL PLANS. BIG CITY ENERGY.
            </p>

            <h1 className={styles.heroTitle}>
              YOUR CITY.
              <br />
              YOUR NEXT
              <br />
              <span>ADVENTURE.</span>
            </h1>

            <p className={styles.heroDescription}>
              Unexpected corners, good company, and new favorite
              places. Explore student-made adventures around NYC
              or create one of your own.
            </p>

            <Link href="/sidequest" className={styles.heroButton}>
              CREATE A SIDEQUEST <span aria-hidden="true">↗</span>
            </Link>
          </div>

          <div className={styles.heroArtwork} aria-hidden="true">
            <span className={styles.heroFlower}>✳</span>
            <div className={styles.heroCircle}>
              <span>GO</span>
              <span>EXPLORE</span>
              <span>NYC!</span>
            </div>
            <span className={styles.heroSparkle}>✷</span>
            <span className={styles.heroSmallText}>
              YOUR NEXT FAVORITE PLACE IS OUT THERE.
            </span>
          </div>
        </section>

        {/* DECORATIVE STRIP */}
        <div className={styles.ticker} aria-hidden="true">
          <span>WANDER MORE</span>
          <span>✳</span>
          <span>DISCOVER MORE</span>
          <span>✳</span>
          <span>MAKE MEMORIES</span>
          <span>✳</span>
          <span>WANDER MORE</span>
        </div>

        {/* COMMUNITY SECTION */}
        <section className={styles.communitySection}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionEyebrow}>
                THE COMMUNITY COLLECTION
              </p>

              <h2 className={styles.sectionTitle}>
                EXPLORE SIDEQUESTS<span>.</span>
              </h2>

              <p className={styles.sectionDescription}>
                Real places. New perspectives. Adventures worth
                sharing.
              </p>
            </div>

            {!error && sidequests.length > 0 && (
              <span className={styles.collectionCount}>
                {sidequests.length} SHARED
              </span>
            )}
          </div>

          {/* DATABASE ERROR */}
          {error && (
            <div className={styles.messageCard} role="alert">
              Could not load published SideQuests.
              Please try again later.
            </div>
          )}

          {/* EMPTY STATE */}
          {!error && sidequests.length === 0 && (
            <div className={styles.messageCard}>
              <h3>NO SIDEQUESTS YET!</h3>

              <p>
                The city is waiting. Be the first to share an
                adventure.
              </p>

              <Link href="/sidequest" className={styles.darkButton}>
                CREATE THE FIRST SIDEQUEST ↗
              </Link>
            </div>
          )}

          {/* SIDEQUEST CARDS */}
          {!error && (
            <div className={styles.cards}>
              {sidequests.map((sidequest, index) => {
                const photo = sidequest.photo;

                const { description, estimate } = getGuidePreview(
                  sidequest.generated_guide,
                  sidequest.title
                );

                return (
                  <article
                    key={sidequest.id}
                    className={styles.card}
                  >
                    {/* VERTICAL PHOTO ON THE LEFT */}
                    <div className={styles.cardMedia}>
                      {photo?.url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={photo.url}
                          alt={`Photograph associated with ${photo.place}`}
                          className={styles.cardImage}
                          loading="lazy"
                        />
                      ) : (
                        <div className={styles.photoPlaceholder}>
                          <span>✳</span>
                          <strong>NYC SIDEQUEST</strong>
                          <small>GO SOMEWHERE NEW</small>
                        </div>
                      )}
                    </div>

                    {/* CONTENT ON THE RIGHT */}
                    <div className={styles.cardContent}>
                      <div className={styles.cardTop}>
                        <span className={styles.cardLabel}>
                          COMMUNITY SIDEQUEST
                        </span>

                        <span className={styles.cardNumber}>
                          NO. {String(index + 1).padStart(2, "0")}
                        </span>
                      </div>

                      <div className={styles.cardMain}>
                        <h3 className={styles.cardTitle}>
                          {sidequest.title}
                        </h3>

                        <p className={styles.cardDescription}>
                          {description}
                        </p>

                        {estimate && (
                          <div className={styles.estimate}>
                            <span aria-hidden="true">◷</span>
                            {estimate}
                          </div>
                        )}
                      </div>

                      {/* FULL ITINERARY */}
                      <details className={styles.details}>
                        <summary className={styles.detailsSummary}>
                          <span>VIEW FULL ITINERARY</span>
                          <span aria-hidden="true">↘</span>
                        </summary>

                        <div className={styles.fullGuide}>
                          {sidequest.generated_guide}
                        </div>
                      </details>

                      {/* KEEP EXISTING VOTING FUNCTIONALITY */}
                      <div className={styles.votingArea}>
                        <VoteButtons
                          sidequestId={sidequest.id}
                          isLoggedIn={Boolean(user)}
                          initialVote={
                            userVotes[sidequest.id] ?? null
                          }
                        />
                      </div>

                      {/* REQUIRED PHOTO ATTRIBUTION */}
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
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <footer className={styles.footer}>
          <span>✳ NYC SIDEQUEST</span>
          <span>MADE FOR THE CURIOUS.</span>
        </footer>
      </div>
    </main>
  );
}
