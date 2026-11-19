
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

type PhotoInput = {
  place: string;
  url: string;
  credit: string;
  license: string;
  sourceUrl: string;
  licenseUrl?: string | null;
};

function validUrl(value: unknown) {
  if (typeof value !== "string") return false;

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isValidPhoto(value: unknown): value is PhotoInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const photo = value as Record<string, unknown>;

  if (
    typeof photo.place !== "string" ||
    typeof photo.credit !== "string" ||
    typeof photo.license !== "string" ||
    typeof photo.sourceUrl !== "string" ||
    !validUrl(photo.url) ||
    !validUrl(photo.sourceUrl)
  ) {
    return false;
  }

  const imageHost = new URL(photo.url as string).hostname;

  // The existing photo search retrieves Wikimedia photos.
  return (
    imageHost === "upload.wikimedia.org" ||
    imageHost === "thumb.wikimedia.org"
  );
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Please sign in." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { sidequestId, photo } = body;

    if (
      typeof sidequestId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        sidequestId
      ) ||
      !isValidPhoto(photo)
    ) {
      return NextResponse.json(
        { error: "Invalid photo information." },
        { status: 400 }
      );
    }

    // Only save photos to the signed-in user's
    // unpublished Sidequests that have no photo yet.
    const { data, error } = await supabase
      .from("sidequests")
      .update({ photo })
      .eq("id", sidequestId)
      .eq("user_id", user.id)
      .eq("is_published", false)
      .is("photo", null)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Photo save error:", error.message);

      return NextResponse.json(
        { error: "Unable to save photo." },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Sidequest not found or not eligible for updating." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      sidequestId: data.id,
    });
  } catch (error) {
    console.error("Photo save failed:", error);

    return NextResponse.json(
      { error: "Could not save photo." },
      { status: 500 }
    );
  }
}
