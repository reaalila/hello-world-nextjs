
import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "You must be logged in." },
        { status: 401 }
      );
    }

    const body = await request.json();

    const prompt =
      typeof body.prompt === "string"
        ? body.prompt.trim()
        : "";

    if (!prompt || prompt.length > 500) {
      return NextResponse.json(
        { error: "Enter a description up to 500 characters." },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Gemini API key is missing." },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const instructions =
      "Write one short, funny, creative social media caption " +
      "for the following moment. Return only the caption.\n\n" +
      prompt;

    let generatedCaption = "";

    const attempts = [
      { model: "gemini-3.8-flash", delay: 0 },
      { model: "gemini-3.5-flash-lite", delay: 1000 },
      { model: "gemini-3.5-flash-lite", delay: 2000 },
    ];

    for (const attempt of attempts) {
      if (attempt.delay > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, attempt.delay)
        );
      }

      try {
        const response = await ai.models.generateContent({
          model: attempt.model,
          contents: instructions,
        });

        generatedCaption = response.text?.trim() || "";

        if (generatedCaption) {
          break;
        }

        return NextResponse.json(
          { error: "Gemini did not return a caption." },
          { status: 502 }
        );
      } catch (error) {
        console.error("Gemini request failed:", error);

        const status =
          error !== null &&
          typeof error === "object" &&
          "status" in error
            ? error.status
            : undefined;

        if (status !== 503) {
          throw error;
        }
      }
    }

    if (!generatedCaption) {
      return NextResponse.json(
        {
          error:
            "Gemini is currently busy. Please try again shortly.",
        },
        { status: 503 }
      );
    }

    const { data, error } = await supabase
      .from("captions")
      .insert({
        user_id: user.id,
        prompt,
        generated_caption: generatedCaption,
      })
      .select()
      .single();

    if (error) {
      console.error("Database error:", error);

      return NextResponse.json(
        { error: "Could not save the caption." },
        { status: 500 }
      );
    }

    return NextResponse.json({ caption: data });
  } catch (error) {
    console.error("Generation error:", error);

    return NextResponse.json(
      { error: "Something went wrong." },
      { status: 500 }
    );
  }
}
