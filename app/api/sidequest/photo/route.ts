import { NextResponse } from "next/server";

type Coordinates = {
  lat: number;
  lon: number;
};

type WikipediaPage = {
  title: string;
  missing?: boolean;
  pageimage?: string;
  thumbnail?: {
    source: string;
    width: number;
    height: number;
  };
  extract?: string;
  coordinates?: Coordinates[];
};

type WikipediaResponse = {
  query?: {
    pages?: WikipediaPage[];
  };
};

type CommonsFile = {
  imageinfo?: {
    mime?: string;
    extmetadata?: Record<
      string,
      { value: string }
    >;
  }[];
};

type CommonsResponse = {
  query?: {
    pages?: CommonsFile[];
  };
};

type PlacePhoto = {
  place: string;
  url: string;
  credit: string;
  license: string;
  sourceUrl: string;
  licenseUrl: string | null;
};

const WIKIPEDIA_API =
  "https://en.wikipedia.org/w/api.php";

// Approximate NYC bounds.
// Used to reject obviously unrelated locations.
const NYC_BOUNDS = {
  south: 40.47,
  north: 40.93,
  west: -74.27,
  east: -73.68,
};

// Remove HTML tags and common entities.
function cleanText(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

// Normalize place names for matching.
function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

// Return an empty photo result.
// The client already displays its placeholder.
function noPhoto() {
  return NextResponse.json({
    photo: null,
  });
}

// Allow images from trusted Wikimedia hosts only.
function isWikimediaImage(url: string): boolean {
  try {
    const parsed = new URL(url);

    return (
      parsed.protocol === "https:" &&
      [
        "upload.wikimedia.org",
        "thumb.wikimedia.org",
      ].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

// Accept only supported reusable licenses.
function isReusableLicense(
  license: string
): boolean {
  return /^(CC0(?:\s|$)|CC[- ]*BY(?:[- ]*SA)?(?:[- ]\d+(?:\.\d+)?)?(?:\s|$)|Public domain|PD(?:[- ]|\s|$))/i.test(
    license
  );
}

// Wikipedia article names sometimes differ
// from the neighborhood names used by Gemini.
const NEIGHBORHOOD_ARTICLES: Record<
  string,
  string[]
> = {
  "east village": [
    "East Village, Manhattan",
  ],

  "west village": [
    "West Village",
    "Greenwich Village",
  ],

  "greenwich village": [
    "Greenwich Village",
  ],

  "lower east side": [
    "Lower East Side",
    "Lower East Side, Manhattan",
  ],

  chinatown: [
    "Chinatown, Manhattan",
  ],

  "little italy": [
    "Little Italy, Manhattan",
  ],

  soho: [
    "SoHo, Manhattan",
  ],

  tribeca: [
    "Tribeca",
  ],

  "upper west side": [
    "Upper West Side",
  ],

  "upper east side": [
    "Upper East Side",
  ],

  harlem: [
    "Harlem",
  ],

  "morningside heights": [
    "Morningside Heights, Manhattan",
  ],

  chelsea: [
    "Chelsea, Manhattan",
  ],

  "flatiron district": [
    "Flatiron District",
  ],

  "financial district": [
    "Financial District, Manhattan",
  ],

  dumbo: [
    "Dumbo, Brooklyn",
  ],

  williamsburg: [
    "Williamsburg, Brooklyn",
  ],

  bushwick: [
    "Bushwick, Brooklyn",
  ],

  "park slope": [
    "Park Slope",
  ],

  "brooklyn heights": [
    "Brooklyn Heights",
  ],

  greenpoint: [
    "Greenpoint, Brooklyn",
  ],

  astoria: [
    "Astoria, Queens",
  ],

  flushing: [
    "Flushing, Queens",
  ],

  "long island city": [
    "Long Island City",
  ],

  "forest hills": [
    "Forest Hills, Queens",
  ],

  "roosevelt island": [
    "Roosevelt Island",
  ],

  "fort tryon park": [
    "Fort Tryon Park",
  ],
};

// Build a short list of article titles.
// Try the exact destination first.
function getArticleCandidates(
  place: string
): string[] {
  const normalized = normalizeName(place);

  const candidates = [
    place,
    ...(NEIGHBORHOOD_ARTICLES[
      normalized
    ] ?? []),
  ];

  return [
    ...new Set(
      candidates
        .map((candidate) =>
          candidate.trim()
        )
        .filter(Boolean)
    ),
  ];
}

// Check whether coordinates fall within
// our approximate NYC geographic bounds.
function isWithinNYC(
  coordinates: Coordinates
): boolean {
  return (
    coordinates.lat >= NYC_BOUNDS.south &&
    coordinates.lat <= NYC_BOUNDS.north &&
    coordinates.lon >= NYC_BOUNDS.west &&
    coordinates.lon <= NYC_BOUNDS.east
  );
}

// Require geographic evidence that the
// article describes a New York City location.
//
// If Wikipedia provides coordinates, those
// take priority. This rejects places such
// as Pebble Beach, California.
//
// If coordinates are missing, require explicit
// NYC context in the article introduction.
function isRelevantNYCArticle(
  page: WikipediaPage
): boolean {
  if (
    page.coordinates &&
    page.coordinates.length > 0
  ) {
    return page.coordinates.some(isWithinNYC);
  }

  const articleContext = [
    page.title,
    page.extract ?? "",
  ].join(" ");

  return /\b(new york city|new york|manhattan|brooklyn|queens|the bronx|bronx|staten island)\b/i.test(
    articleContext
  );
}

// Find a freely licensed Wikipedia thumbnail.
async function getWikipediaPage(
  place: string,
  headers: Record<string, string>
): Promise<WikipediaPage | null> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    titles: place,
    redirects: "1",
    prop: "pageimages|extracts|coordinates",
    piprop: "thumbnail|name",
    pithumbsize: "1200",
    pilicense: "free",
    exintro: "1",
    explaintext: "1",
    exsentences: "3",
    colimit: "1",
  });

  const response = await fetch(
    `${WIKIPEDIA_API}?${params.toString()}`,
    {
      headers,
      next: {
        revalidate: 86400,
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  const data =
    (await response.json()) as WikipediaResponse;

  const page = data.query?.pages?.[0];

  if (
    !page ||
    page.missing ||
    !page.pageimage ||
    !page.thumbnail
  ) {
    return null;
  }

  // Reject unrelated geographic results.
  if (!isRelevantNYCArticle(page)) {
    console.warn(
      `Rejected non-NYC photograph: "${place}" resolved to "${page.title}".`
    );

    return null;
  }

  const {
    source,
    width,
    height,
  } = page.thumbnail;

  if (
    !isWikimediaImage(source) ||
    width < 450 ||
    height <= 0
  ) {
    return null;
  }

  return page;
}

// Retrieve image copyright and attribution.
async function getPhotoMetadata(
  page: WikipediaPage,
  headers: Record<string, string>
): Promise<PlacePhoto | null> {
  if (
    !page.pageimage ||
    !page.thumbnail
  ) {
    return null;
  }

  const fileTitle = page.pageimage.startsWith(
    "File:"
  )
    ? page.pageimage
    : `File:${page.pageimage}`;

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    titles: fileTitle,
    prop: "imageinfo",
    iiprop: "mime|extmetadata",
  });

  const response = await fetch(
    `${WIKIPEDIA_API}?${params.toString()}`,
    {
      headers,
      next: {
        revalidate: 86400,
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  const data =
    (await response.json()) as CommonsResponse;

  const file = data.query?.pages?.[0];

  const imageInfo =
    file?.imageinfo?.[0];

  // Preserve the existing preference
  // for photographic JPEG images.
  if (imageInfo?.mime !== "image/jpeg") {
    return null;
  }

  const metadata =
    imageInfo.extmetadata ?? {};

  const license = cleanText(
    metadata.LicenseShortName?.value ?? ""
  );

  if (
    !license ||
    !isReusableLicense(license)
  ) {
    return null;
  }

  const rawLicenseUrl = cleanText(
    metadata.LicenseUrl?.value ?? ""
  );

  let licenseUrl: string | null = null;

  if (rawLicenseUrl) {
    try {
      const parsed = new URL(
        rawLicenseUrl
      );

      if (
        parsed.protocol === "https:" &&
        [
          "creativecommons.org",
          "www.creativecommons.org",
          "commons.wikimedia.org",
        ].includes(parsed.hostname) &&
        rawLicenseUrl.length <= 2048
      ) {
        licenseUrl = rawLicenseUrl;
      }
    } catch {
      licenseUrl = null;
    }
  }

  const credit =
    cleanText(
      metadata.Artist?.value ?? ""
    ).slice(0, 160) ||
    "Unknown photographer";

  const sourceUrl =
    "https://commons.wikimedia.org/wiki/" +
    encodeURIComponent(
      fileTitle.replaceAll(" ", "_")
    );

  return {
    place: page.title,
    url: page.thumbnail.source,
    credit,
    license,
    sourceUrl,
    licenseUrl,
  };
}

// Main photo lookup endpoint.
export async function GET(
  request: Request
) {
  const { searchParams } = new URL(
    request.url
  );

  const place = searchParams
    .get("place")
    ?.trim();

  // STEP 1: Validate the requested location.
  if (
    !place ||
    place.length > 120
  ) {
    return NextResponse.json(
      {
        error: "Invalid place.",
      },
      {
        status: 400,
      }
    );
  }

  const headers = {
    "User-Agent":
      "SideQuestNYC/1.0 (https://hello-world-nextjs-rouge.vercel.app)",
    Accept: "application/json",
  };

  // STEP 2: Build article candidates.
  const candidates = getArticleCandidates(
    place
  );

  // STEP 3: Search candidates in order.
  for (const candidate of candidates) {
    try {
      const page = await getWikipediaPage(
        candidate,
        headers
      );

      if (!page) {
        continue;
      }

      // STEP 4: Check license and attribution.
      const photo = await getPhotoMetadata(
        page,
        headers
      );

      if (!photo) {
        continue;
      }

      // STEP 5: Return the verified article photo.
      return NextResponse.json({
        photo,
      });
    } catch (error) {
      console.error(
        `Photo lookup failed for "${candidate}":`,
        error
      );
    }
  }

  // STEP 6: No confidently relevant photo.
  // Let the client show the existing placeholder.
  return noPhoto();
}
