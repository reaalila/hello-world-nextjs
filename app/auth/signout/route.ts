import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");

    if (origin && origin !== request.nextUrl.origin) {
      return NextResponse.json(
        { error: "Invalid request origin." },
        { status: 403 }
      );
    }

    const supabase = await createClient();

    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Sign-out error:", error);

      return NextResponse.json(
        { error: "Could not sign out. Please try again." },
        { status: 500 }
      );
    }

    revalidatePath("/", "layout");

    return NextResponse.redirect(
      new URL("/community", request.url),
      { status: 303 }
    );
  } catch (error) {
    console.error("Sign-out failed:", error);

    return NextResponse.json(
      { error: "Could not sign out." },
      { status: 500 }
    );
  }
}
