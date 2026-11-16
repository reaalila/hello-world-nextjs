import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

type PlacePhoto = {
  place: string;
  url: string;
  credit: string;
  license: string;
  sourceUrl: string;
  licenseUrl: string | null;
};

function isSafeUrl(
  value: string,
  allowedHosts: string[]
): boolean {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      allowedHosts.includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function validatePhoto(value: unknown): PlacePhoto | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const photo = value as Record<string, unknown>;

  if (
    typeof photo.place !== "string" ||
    typeof photo.url !== "string" ||
    typeof photo.credit !== "string" ||
    typeof photo.license !== "string" ||
    typeof photo.sourceUrl !== "string"
  ) {
    return null;
  }

  if (
    photo.place.length > 200 ||
    photo.credit.length > 500 ||
    photo.license.length > 100 ||
    photo.url.length > 2048 ||
    photo.sourceUrl.length > 2048
  ) {
    return null;
  }

  // Only allow images hosted by Wikimedia.
  if (
    !isSafeUrl(photo.url, [
      "upload.wikimedia.org",
      "thumb.wikimedia.org",
    ])
  ) {
    return null;
  }

  // Require a real Wikimedia Commons source.
  if (
    !isSafeUrl(photo.sourceUrl, [
      "commons.wikimedia.org",
    ])
  ) {
    return null;
  }

  const licenseUrl =
    typeof photo.licenseUrl === "string"
      ? photo.licenseUrl
      : null;

  if (
    licenseUrl &&
    !isSafeUrl(licenseUrl, [
      "creativecommons.org",
      "www.creativecommons.org",
      "commons.wikimedia.org",
    ])
  ) {
    return null;
  }

  return {
    place: photo.place,
    url: photo.url,
    credit: photo.credit,
    license: photo.license,
    sourceUrl: photo.sourceUrl,
    licenseUrl,
  };
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // STEP 1: Require authentication.
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          error: "Please sign in to publish a SideQuest.",
        },
        { status: 401 }
      );
    }

    // STEP 2: Read the request.
    let body: Record<string, unknown>;

    try {
      const parsed: unknown = await request.json();

      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        throw new Error("Invalid request body");
      }

      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400 }
      );
    }

    const sidequestId = body.sidequestId;

    // STEP 3: Validate the SideQuest ID.
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (
      typeof sidequestId !== "string" ||
      !uuidPattern.test(sidequestId)
    ) {
      return NextResponse.json(
        { error: "Invalid SideQuest ID." },
        { status: 400 }
      );
    }

    // STEP 4: Validate optional photograph metadata.
    let photo: PlacePhoto | null = null;

    if (body.photo != null) {
      photo = validatePhoto(body.photo);

      if (!photo) {
        return NextResponse.json(
          { error: "Invalid photograph information." },
          { status: 400 }
        );
      }
    }

    // STEP 5: Publish only a SideQuest owned
    // by the currently authenticated user.
    const {
      data: sidequest,
      error: publishError,
    } = await supabase
      .from("sidequests")
      .update({
        is_published: true,
        photo,
      })
      .eq("id", sidequestId)
      .eq("user_id", user.id)
      .eq("is_published", false)
      .select("id, title, is_published, photo")
      .maybeSingle();

    if (publishError) {
      console.error(
        "SideQuest publishing error:",
        publishError
      );

      return NextResponse.json(
        { error: "Could not publish your SideQuest." },
        { status: 500 }
      );
    }

    if (!sidequest) {
      return NextResponse.json(
        {
          error:
            "SideQuest not found, already published, or not owned by you.",
        },
        { status: 404 }
      );
    }

    // STEP 6: Return the published SideQuest.
    return NextResponse.json({
      success: true,
      sidequest,
    });
  } catch (error) {
    console.error(
      "SideQuest publish request failed:",
      error
    );

    return NextResponse.json(
      { error: "Could not publish your SideQuest." },
      { status: 500 }
    );
  }
}
