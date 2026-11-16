import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // STEP 1: Require a signed-in user.
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          error: "Please sign in to vote on SideQuests.",
        },
        { status: 401 }
      );
    }

    // STEP 2: Read the vote request.
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400 }
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400 }
      );
    }

    const input = body as Record<string, unknown>;

    const sidequestId = input.sidequestId;
    const vote = input.vote;

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

    // STEP 4: Only allow upvotes and downvotes.
    //  1 = upvote
    // -1 = downvote
    if (vote !== 1 && vote !== -1) {
      return NextResponse.json(
        { error: "Vote must be 1 or -1." },
        { status: 400 }
      );
    }

    // STEP 5: Verify that the SideQuest is published.
    const {
      data: sidequest,
      error: sidequestError,
    } = await supabase
      .from("sidequests")
      .select("id")
      .eq("id", sidequestId)
      .eq("is_published", true)
      .maybeSingle();

    if (sidequestError) {
      console.error(
        "SideQuest lookup error:",
        sidequestError
      );

      return NextResponse.json(
        { error: "Could not verify the SideQuest." },
        { status: 500 }
      );
    }

    if (!sidequest) {
      return NextResponse.json(
        {
          error: "This SideQuest is not available for voting.",
        },
        { status: 404 }
      );
    }

    // STEP 6: Save the user's vote.
    //
    // If this user has never voted on this SideQuest,
    // insert a new row.
    //
    // If they have already voted, update their vote.
    //
    // The database's composite primary key prevents
    // duplicate votes by the same user.
    const {
      data: savedVote,
      error: voteError,
    } = await supabase
      .from("sidequest_votes")
      .upsert(
        {
          sidequest_id: sidequestId,
          user_id: user.id,
          vote,
        },
        {
          onConflict: "sidequest_id,user_id",
        }
      )
      .select("sidequest_id, user_id, vote")
      .single();

    if (voteError || !savedVote) {
      console.error(
        "SideQuest vote error:",
        voteError
      );

      return NextResponse.json(
        { error: "Could not save your vote." },
        { status: 500 }
      );
    }

    // STEP 7: Confirm the saved vote.
    return NextResponse.json({
      success: true,
      sidequestId: savedVote.sidequest_id,
      vote: savedVote.vote,
    });
  } catch (error) {
    console.error(
      "SideQuest voting failed:",
      error
    );

    return NextResponse.json(
      { error: "Something went wrong while voting." },
      { status: 500 }
    );
  }
}
