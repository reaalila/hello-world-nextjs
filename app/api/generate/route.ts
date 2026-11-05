import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

const STYLES = ["Funny", "Witty", "Aesthetic", "Simple"];

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

    const imagePath =
      typeof body.imagePath === "string"
        ? body.imagePath
        : "";

    const style =
      typeof body.style === "string"
        ? body.style
        : "Funny";

    if (!STYLES.includes(style)) {
      return NextResponse.json(
        { error: "Invalid caption style." },
        { status: 400 }
      );
    }

    if ((!prompt && !imagePath) || prompt.length > 500) {
      return NextResponse.json(
        {
          error:
            "Add a photo or enter a description up to 500 characters.",
        },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Gemini API key is not configured." },
        { status: 500 }
      );
    }

    let imageData: string | null = null;
    let imageMimeType: string | null = null;

    if (imagePath) {
      const validPath =
        /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(
          imagePath
        );

      if (
        !validPath ||
        !imagePath.startsWith(`${user.id}/`)
      ) {
        return NextResponse.json(
          { error: "Invalid image path." },
          { status: 400 }
        );
      }

      const { data: imageBlob, error: imageError } =
        await supabase.storage
          .from("caption-images")
          .download(imagePath);

      if (imageError || !imageBlob) {
        return NextResponse.json(
          { error: "Could not access the uploaded photo." },
          { status: 400 }
        );
      }

      const imageBytes = await imageBlob.arrayBuffer();

      if (imageBytes.byteLength > 5 * 1024 * 1024) {
        return NextResponse.json(
          { error: "The photo must be smaller than 5 MB." },
          { status: 400 }
        );
      }

      const extension = imagePath.split(".").pop();

      imageMimeType =
        extension === "png"
          ? "image/png"
          : extension === "webp"
            ? "image/webp"
            : "image/jpeg";

      imageData = Buffer.from(imageBytes).toString("base64");
    }

    const styleInstructions: Record<string, string> = {
      Funny:
        "Playful and genuinely funny. Use relatable humor.",
      Witty:
        "Clever, sharp, and creative. Avoid forced jokes.",
      Aesthetic:
        "Elegant, expressive, and suitable for an aesthetic social media post.",
      Simple:
        "Short, natural, casual, and easy to understand.",
    };

    const instructions = `
Generate exactly THREE different social media captions.

Style: ${style}
Style instructions: ${styleInstructions[style]}

${
  imagePath
    ? "Look closely at the attached photo. Make each caption relevant to what is actually visible."
    : "Use the following description to understand the moment."
}

${
  prompt
    ? `Additional user context: ${prompt}`
    : "The user provided a photo without additional context."
}

Requirements:
- Provide three distinct caption options.
- Keep each caption short and natural.
- Follow the selected style.
- Avoid hashtags unless they fit naturally.
- Return JSON containing a "captions" array of exactly three strings.
- Do not include explanations or additional text.
`;

    const contents =
      imageData && imageMimeType
        ? [
            {
              inlineData: {
                mimeType: imageMimeType,
                data: imageData,
              },
            },
            { text: instructions },
          ]
        : instructions;

    const ai = new GoogleGenAI({ apiKey });

    const attempts = [
      { model: "gemini-3.8-flash", delay: 0 },
      { model: "gemini-3.5-flash-lite", delay: 1000 },
      { model: "gemini-3.5-flash-lite", delay: 2000 },
    ];

    let generatedCaptions: string[] = [];

    for (const attempt of attempts) {
      if (attempt.delay > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, attempt.delay)
        );
      }

      try {
        const response = await ai.models.generateContent({
          model: attempt.model,
          contents,
          config: {
            responseMimeType: "application/json",
            responseJsonSchema: {
              type: "object",
              properties: {
                captions: {
                  type: "array",
                  minItems: 3,
                  maxItems: 3,
                  items: { type: "string" },
                },
              },
              required: ["captions"],
            },
          },
        });

        const result = JSON.parse(response.text || "{}");
        const options = result.captions;

        if (
          !Array.isArray(options) ||
          options.length !== 3 ||
          !options.every(
            (caption) =>
              typeof caption === "string" &&
              caption.trim().length > 0 &&
              caption.trim().length <= 250
          )
        ) {
          throw new Error(
            "Gemini did not return three valid captions."
          );
        }

        const cleaned = options.map((caption: string) =>
          caption.trim()
        );

        if (new Set(cleaned).size !== 3) {
          throw new Error(
            "Gemini returned duplicate caption options."
          );
        }

        generatedCaptions = cleaned;
        break;
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

    if (generatedCaptions.length !== 3) {
      return NextResponse.json(
        {
          error:
            "Gemini is currently busy. Please try again shortly.",
        },
        { status: 503 }
      );
    }

    // Nothing is published yet.
    // The user will choose one caption in the interface.
    return NextResponse.json({
      captions: generatedCaptions,
    });
  } catch (error) {
    console.error("Caption generation error:", error);

    return NextResponse.json(
      {
        error:
          "Could not generate caption options. Please try again.",
      },
      { status: 500 }
    );
  }
}
