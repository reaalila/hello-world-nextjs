import { NextResponse } from "next/server";

type WikipediaPage = {
  title: string;
  missing?: boolean;
  pageimage?: string;
  thumbnail?: {
    source: string;
    width: number;
    height: number;
  };
};

type WikipediaResponse = {
  query?: {
    pages?: WikipediaPage[];
  };
};

type CommonsFile = {
  imageinfo?: {
    mime?: string;
    extmetadata?: Record<string, { value: string }>;
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

// Remove HTML tags and decode common HTML entities.
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

// Normalize location names for matching.
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

// Return a safe empty photo result.
function noPhoto() {
  return NextResponse.json({
    photo: null,
  });
}

// Only accept HTTPS URLs from trusted Wikimedia hosts.
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

// Only allow reusable image licenses.
function isReusableLicense(license: string): boolean {
  return /^(CC0(?:\s|$)|CC[- ]BY(?:[- ]SA)?(?:[- ]\d+(?:\.\d+)?)?(?:\s|$)|Public domain|PD(?:[- ]|$))/i.test(
    license
  );
}

// NYC neighborhood titles sometimes differ
// from their actual Wikipedia article names.
const NEIGHBORHOOD_ARTICLES: Record<string, string[]> = {
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

  "chinatown": [
    "Chinatown, Manhattan",
  ],

  "little italy": [
    "Little Italy, Manhattan",
  ],

  "soho": [
    "SoHo, Manhattan",
  ],

  "tribeca": [
    "Tribeca",
  ],

  "upper west side": [
    "Upper West Side",
  ],

  "upper east side": [
    "Upper East Side",
  ],

  "harlem": [
    "Harlem",
  ],

  "morningside heights": [
    "Morningside Heights, Manhattan",
  ],

  "chelsea": [
    "Chelsea, Manhattan",
  ],

  "flatiron district": [
    "Flatiron District",
  ],

  "financial district": [
    "Financial District, Manhattan",
  ],

  "dumbo": [
    "Dumbo, Brooklyn",
  ],

  "williamsburg": [
    "Williamsburg, Brooklyn",
  ],

  "bushwick": [
    "Bushwick, Brooklyn",
  ],

  "park slope": [
    "Park Slope",
  ],

  "brooklyn heights": [
    "Brooklyn Heights",
  ],

  "greenpoint": [
    "Greenpoint, Brooklyn",
  ],

  "astoria": [
    "Astoria, Queens",
  ],

  "flushing": [
    "Flushing, Queens",
  ],

  "long island city": [
    "Long Island City",
  ],

  "forest hills": [
    "Forest Hills, Queens",
  ],
};

// Generate a small set of article titles.
// Prioritize the exact destination.
function getArticleCandidates(place: string): string[] {
  const normalized = normalizeName(place);

  const candidates = [
    place,
    ...(NEIGHBORHOOD_ARTICLES[normalized] ?? []),
  ];

  return [
    ...new Set(
      candidates
        .map((candidate) => candidate.trim())
        .filter(Boolean)
    ),
  ];
}

// Retrieve a Wikipedia article with a free thumbnail.
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
    prop: "pageimages",
    piprop: "thumbnail|name",
    pithumbsize: "1200",
    pilicense: "free",
  });

  const response = await fetch(
    `https://en.wikipedia.org/w/api.php?${params.toString()}`,
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

  const { source, width, height } = page.thumbnail;

  // Reject invalid or very small images.
  if (
    !isWikimediaImage(source) ||
    width < 450 ||
    height <= 0
  ) {
    return null;
  }

  return page;
}

// Retrieve the licensing metadata for an image.
async function getPhotoMetadata(
  page: WikipediaPage,
  headers: Record<string, string>
): Promise<PlacePhoto | null> {
  if (!page.pageimage || !page.thumbnail) {
    return null;
  }

  const fileTitle = page.pageimage.startsWith("File:")
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
    `https://en.wikipedia.org/w/api.php?${params.toString()}`,
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
  const imageInfo = file?.imageinfo?.[0];

  // Prefer photographic JPEG files.
  if (imageInfo?.mime !== "image/jpeg") {
    return null;
  }

  const metadata = imageInfo.extmetadata ?? {};

  const license = cleanText(
    metadata.LicenseShortName?.value ?? ""
  );

  if (!license || !isReusableLicense(license)) {
    return null;
  }

  const rawLicenseUrl = cleanText(
    metadata.LicenseUrl?.value ?? ""
  );

  let licenseUrl: string | null = null;

  if (rawLicenseUrl) {
    try {
      const parsed = new URL(rawLicenseUrl);

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
    ).slice(0, 160) || "Unknown photographer";

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
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const place = searchParams.get("place")?.trim();

  // STEP 1: Validate the requested location.
  if (!place || place.length > 120) {
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

  // STEP 2: Build candidate article titles.
  const candidates = getArticleCandidates(place);

  // STEP 3: Search each candidate until
  // we find a suitable reusable photograph.
  for (const candidate of candidates) {
    try {
      const page = await getWikipediaPage(
        candidate,
        headers
      );

      if (!page) {
        continue;
      }

      // STEP 4: Validate licensing and attribution.
      const photo = await getPhotoMetadata(
        page,
        headers
      );

      if (!photo) {
        continue;
      }

      // STEP 5: Return the first suitable photograph.
      return NextResponse.json({
        photo,
      });
    } catch (error) {
      console.error(
        `Photo lookup failed for "${candidate}":`,
        error
      );

      // Try another article candidate.
      continue;
    }
  }

  // STEP 6: Nothing suitable was found.
  // Let the frontend display its branded placeholder.
  return noPhoto();
}
