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

type CommonsFile = {
  imageinfo?: {
    mime?: string;
    extmetadata?: Record<string, { value: string }>;
  }[];
};

function cleanText(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .toLowerCase()
    .trim();
}

function noPhoto() {
  return NextResponse.json({ photo: null });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const place = searchParams.get("place")?.trim();

  if (!place || place.length > 120) {
    return NextResponse.json(
      { error: "Invalid place." },
      { status: 400 }
    );
  }

  const headers = {
    "User-Agent":
      "SideQuestNYC/1.0 (https://hello-world-nextjs-rouge.vercel.app)",
    Accept: "application/json",
  };

  try {
    // STEP 1: Search for the location's Wikipedia article.
    const articleParams = new URLSearchParams({
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

    const articleResponse = await fetch(
      `https://en.wikipedia.org/w/api.php?${articleParams}`,
      {
        headers,
        next: { revalidate: 86400 },
      }
    );

    if (!articleResponse.ok) {
      return noPhoto();
    }

    const articleData = await articleResponse.json();

    const page = (
      articleData.query?.pages ?? []
    )[0] as WikipediaPage | undefined;

    // STEP 2: Check that the article has a photograph.
    if (
      !page ||
      page.missing ||
      !page.pageimage ||
      !page.thumbnail
    ) {
      return noPhoto();
    }

    const { source, width, height } = page.thumbnail;

    const isWikimediaImage =
      source.startsWith("https://upload.wikimedia.org/") ||
      source.startsWith("https://thumb.wikimedia.org/");

    if (
      !isWikimediaImage ||
        width < 450 ||
        height <= 0
    ) {
      return noPhoto();
    }

    // STEP 3: Retrieve licensing details from Commons.
    const fileTitle = `File:${page.pageimage}`;

    const fileParams = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      titles: fileTitle,
      prop: "imageinfo",
      iiprop: "mime|extmetadata",
    });

    const fileResponse = await fetch(
        `https://en.wikipedia.org/w/api.php?${fileParams}`,
      {
        headers,
        next: { revalidate: 86400 },
      }
    );

    if (!fileResponse.ok) {
      return noPhoto();
    }

    const fileData = await fileResponse.json();

    const file = (
      fileData.query?.pages ?? []
    )[0] as CommonsFile | undefined;

    const imageInfo = file?.imageinfo?.[0];

    // Prefer photographic JPEG files for this version.
    if (imageInfo?.mime !== "image/jpeg") {
      return noPhoto();
    }

    const metadata = imageInfo.extmetadata ?? {};

    const license = cleanText(
      metadata.LicenseShortName?.value ?? ""
    );

    // STEP 4: Only return suitable reusable photographs.
    const reusable =
      /^(CC0|CC[- ]BY(?:[- ]SA)?|Public domain|PD)/i.test(
        license
      );

    if (!reusable) {
      return noPhoto();
    }

    const rawLicenseUrl =
      metadata.LicenseUrl?.value ?? "";

    const licenseUrl = rawLicenseUrl.startsWith("https://")
      ? rawLicenseUrl
      : null;

    // STEP 5: Return the photograph and attribution.
    return NextResponse.json({
      photo: {
        place: page.title,
        url: source,
        credit: cleanText(
          metadata.Artist?.value ?? "Unknown photographer"
        ).slice(0, 160),
        license,
        sourceUrl:
          "https://commons.wikimedia.org/wiki/" +
          encodeURIComponent(
            fileTitle.replaceAll(" ", "_")
          ),
        licenseUrl,
      },
    });
  } catch (error) {
    console.error(
      "SideQuest photo lookup failed:",
      error
    );

    return noPhoto();
  }
}
