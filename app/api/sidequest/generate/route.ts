import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase-server";

// Keep the existing Gemini model.
const MODEL_NAME = "gemini-3.5-flash-lite";

// Allow one additional attempt when validation fails.
const MAX_GENERATION_ATTEMPTS = 2;

type ItineraryStop = {
  place: string;
  neighborhood: string;
  activity: string;
  durationMinutes: number;
  estimatedCostUsd: number;
  walkMinutesToNext: number;
};

type GeneratedItinerary = {
  title: string;
  tagline: string;
  stops: ItineraryStop[];
};

type ValidatedItinerary = {
  generated: GeneratedItinerary;
  stops: ItineraryStop[];
  totalMinutes: number;
  totalCost: number;
};

// Format minutes into readable durations.
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;

  if (hours === 0) return `${minutes} min`;
  if (remaining === 0) return `${hours} hr`;

  return `${hours} hr ${remaining} min`;
}

// Count words in generated text.
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Extract the student's available time.
function getTimeLimit(text: string): number | null {
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
  };

  const hoursMatch = text.match(
    /\b(\d+(?:\.\d+)?|one|two|three|four|five|six)[\s-]*(?:hours?|hrs?|hr)\b/i
  );

  if (hoursMatch) {
    const value = hoursMatch[1].toLowerCase();
    const hours = words[value] ?? Number(value);

    return Math.round(hours * 60);
  }

  const minutesMatch = text.match(
    /\b(\d+)[\s-]*(?:minutes?|mins?)\b/i
  );

  return minutesMatch
    ? Number(minutesMatch[1])
    : null;
}

// Extract the student's budget.
function getBudget(text: string): number | null {
  const match = text.match(
    /\$\s*(\d+(?:\.\d{1,2})?)/
  );

  return match ? Number(match[1]) : null;
}

// Normalize destination names for duplicate detection.
function normalizePlaceName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

// Validate Gemini's structured response.
function isValidItinerary(
  value: Partial<GeneratedItinerary>
): value is GeneratedItinerary {
  if (
    typeof value.title !== "string" ||
    !value.title.trim() ||
    typeof value.tagline !== "string" ||
    !value.tagline.trim() ||
    wordCount(value.tagline) > 6 ||
    !Array.isArray(value.stops) ||
    value.stops.length < 2 ||
    value.stops.length > 3
  ) {
    return false;
  }

  return value.stops.every(
    (stop) =>
      stop &&
      typeof stop.place === "string" &&
      stop.place.trim().length > 0 &&
      typeof stop.neighborhood === "string" &&
      stop.neighborhood.trim().length > 0 &&
      typeof stop.activity === "string" &&
      wordCount(stop.activity) >= 12 &&
      wordCount(stop.activity) <= 25 &&
      Number.isInteger(stop.durationMinutes) &&
      stop.durationMinutes >= 15 &&
      stop.durationMinutes <= 120 &&
      Number.isFinite(stop.estimatedCostUsd) &&
      stop.estimatedCostUsd >= 0 &&
      Number.isInteger(stop.walkMinutesToNext) &&
      stop.walkMinutesToNext >= 0 &&
      stop.walkMinutesToNext <= 30
  );
}

// Reject vague destination names.
const GENERIC_NAMES = new Set([
  "columbia university campus",
  "university campus",
  "manhattan",
  "new york city",
  "morningside heights",
  "upper west side",
  "neighborhood cafe",
  "local cafe",
  "nearby coffee shop",
]);

// Validate the full itinerary, including constraints.
// Return null when another generation attempt is needed.
function validateGeneratedItinerary(
  value: unknown,
  maxMinutes: number,
  budgetLimit: number | null
): ValidatedItinerary | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<GeneratedItinerary>;

  // STEP A: Validate structure and writing requirements.
  if (!isValidItinerary(candidate)) {
    console.warn(
      "Generated itinerary failed structural validation."
    );

    return null;
  }

  // STEP B: Ensure the last stop has no outgoing walk.
  const stops = candidate.stops.map((stop, index) => ({
    ...stop,
    walkMinutesToNext:
      index === candidate.stops.length - 1
        ? 0
        : stop.walkMinutesToNext,
  }));

  // STEP C: Reject duplicate or vague places.
  const placeNames = stops.map((stop) =>
    normalizePlaceName(stop.place)
  );

  const hasDuplicates =
    new Set(placeNames).size !== placeNames.length;

  const hasGenericPlace = placeNames.some((name) =>
    GENERIC_NAMES.has(name)
  );

  if (hasDuplicates || hasGenericPlace) {
    console.warn(
      "Generated itinerary contains duplicate or generic places."
    );

    return null;
  }

  // STEP D: Calculate total duration.
  const totalMinutes = stops.reduce(
    (sum, stop) =>
      sum +
      stop.durationMinutes +
      stop.walkMinutesToNext,
    0
  );

  // STEP E: Calculate total estimated spending.
  const totalCost = stops.reduce(
    (sum, stop) =>
      sum + stop.estimatedCostUsd,
    0
  );

  // STEP F: Enforce the user's time constraint.
  if (totalMinutes > maxMinutes) {
    console.warn(
      `Itinerary exceeds time limit: ${totalMinutes}/${maxMinutes} minutes.`
    );

    return null;
  }

  // STEP G: Enforce the user's budget constraint.
  if (
    budgetLimit !== null &&
    totalCost > budgetLimit
  ) {
    console.warn(
      `Itinerary exceeds budget: $${totalCost}/$${budgetLimit}.`
    );

    return null;
  }

  return {
    generated: candidate,
    stops,
    totalMinutes,
    totalCost,
  };
}

export async function POST(request: Request) {
  try {
    // STEP 1: Authenticate the user.
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          error: "Please sign in to create a SideQuest.",
        },
        { status: 401 }
      );
    }

    // STEP 2: Read the request.
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400 }
      );
    }

    const userRequest =
      body &&
      typeof body === "object" &&
      "request" in body &&
      typeof body.request === "string"
        ? body.request.trim()
        : "";

    if (
      userRequest.length < 10 ||
      userRequest.length > 500
    ) {
      return NextResponse.json(
        {
          error:
            "Enter a request between 10 and 500 characters.",
        },
        { status: 400 }
      );
    }

    // STEP 3: Configure Gemini.
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Gemini API key is missing." },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const timeLimit = getTimeLimit(userRequest);
    const budgetLimit = getBudget(userRequest);
    const maxMinutes = timeLimit ?? 240;

    // A two-stop itinerary needs at least 30 minutes
    // because each activity must last 15 minutes.
    if (maxMinutes < 30) {
      return NextResponse.json(
        {
          error:
            "Please allow at least 30 minutes for your SideQuest.",
        },
        { status: 400 }
      );
    }

    // STEP 4: Define the generation prompt.
    const prompt = `
You are SideQuest NYC, a creative and practical
mini-itinerary planner for college students
exploring New York City.

STUDENT REQUEST:
${userRequest}

IMPORTANT CONSTRAINTS:
- Maximum duration: ${maxMinutes} minutes.
- Include activity durations and walking times.
- Maximum estimated activity spending:
  ${budgetLimit === null ? "No specified limit" : `$${budgetLimit}`}.
- Times and costs are estimates.

YOUR TASK:
Create ONE personalized NYC itinerary
with exactly 2 or 3 stops.

The result should feel like a thoughtfully
curated local recommendation, not a chatbot response.

----------------------------------------
1. INTERESTING DESTINATIONS
----------------------------------------

Recommend real NYC locations that students
would genuinely enjoy discovering.

Prioritize:
- Lesser-known landmarks
- Distinctive architecture
- Independent bookstores
- Cultural attractions
- Interesting public spaces
- Scenic viewpoints
- Local neighborhood highlights
- Places relevant to the student's interests

Avoid predictable combinations of a
university campus, ordinary park, and generic cafe.

If someone says they are near Columbia,
that does not mean they want to visit campus.

Recommend places that are specific,
recognizable, and worth visiting.

----------------------------------------
2. LOCATION AND ROUTE
----------------------------------------

Choose exactly 2 or 3 distinct places.

Use actual named locations.

Avoid vague recommendations such as:
- Explore Manhattan
- Walk around the neighborhood
- Visit a nearby cafe

Keep the stops geographically close.

Order them to minimize backtracking.

Prefer walking routes when appropriate.

Estimate walking times between stops.

The final stop must have zero walking
minutes afterward.

Do not invent street addresses.

----------------------------------------
3. QUALITY AND VARIETY
----------------------------------------

Create a cohesive itinerary.

Each stop should contribute something
different to the overall outing.

Avoid recommending multiple locations
that offer essentially the same experience.

Balance the student's interests with
interesting discoveries.

Make the recommendations feel personalized
rather than randomly assembled.

----------------------------------------
4. TIME AND BUDGET
----------------------------------------

The combined duration of:
- All activities
- All walking segments

MUST fit within ${maxMinutes} minutes.

The total estimated activity cost
MUST respect the user's budget.

Favor affordable and free experiences
when appropriate.

If no budget is specified,
avoid unnecessary spending.

----------------------------------------
5. ACCURACY
----------------------------------------

Recommend plausible, real NYC locations.

Do not invent:
- Events
- Exhibitions
- Performances
- Opening hours
- Ticket availability
- Street addresses

Do not pretend to have checked live information.

Treat costs and walking times as estimates.

----------------------------------------
6. TITLE
----------------------------------------

Create a short, distinctive, appealing title.

Avoid generic names such as:
- NYC Adventure
- Explore Manhattan
- Fun Day in New York

Avoid repetitive words.

Only mention destinations actually
included in the itinerary.

----------------------------------------
7. TAGLINE
----------------------------------------

Write one tagline of at most 6 words.

Capture the atmosphere or overall
appeal of the outing.

Do not repeat the title.

Avoid generic phrases and filler.

----------------------------------------
8. EACH STOP
----------------------------------------

Every stop must include:

- Specific place name
- Neighborhood
- Activity description
- Estimated activity duration in minutes
- Estimated activity cost in USD
- Estimated walking time to the next stop

For the activity description:

Write ONE complete sentence of
12 to 25 words.

Describe what the visitor can actually
see, discover, or experience there.

Mention one distinctive detail
about the location.

Make the sentence informative and engaging.

Avoid vague sentences such as:
- Enjoy the beautiful scenery.
- Admire the architecture.
- Explore the surrounding area.
- Take some photographs.

Explain what makes each place
interesting or worth visiting.

Do not repeat the title or tagline.

----------------------------------------
9. WRITING STYLE
----------------------------------------

Be concise, clear, and specific.

No introductions.
No long paragraphs.
No repeated explanations.
No "why it fits" sections.
No unnecessary advice.
No games or challenges.
No motivational language.
No concluding paragraphs.
Do not address the student by name.
Do not mention the fictional persona Sam.

----------------------------------------
10. OUTPUT
----------------------------------------

Return ONLY valid JSON matching
the supplied response schema.
`;

    // STEP 5: Define the response structure.
    const schema = {
      type: "object",
      properties: {
        title: {
          type: "string",
        },
        tagline: {
          type: "string",
        },
        stops: {
          type: "array",
          minItems: 2,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              place: {
                type: "string",
              },
              neighborhood: {
                type: "string",
              },
              activity: {
                type: "string",
              },
              durationMinutes: {
                type: "integer",
              },
              estimatedCostUsd: {
                type: "number",
              },
              walkMinutesToNext: {
                type: "integer",
              },
            },
            required: [
              "place",
              "neighborhood",
              "activity",
              "durationMinutes",
              "estimatedCostUsd",
              "walkMinutesToNext",
            ],
          },
        },
      },
      required: [
        "title",
        "tagline",
        "stops",
      ],
    };

    // STEP 6: Generate, validate, and retry if needed.
    let validated: ValidatedItinerary | null = null;

    for (
      let attempt = 1;
      attempt <= MAX_GENERATION_ATTEMPTS;
      attempt++
    ) {
      console.log(
        `Generating SideQuest with ${MODEL_NAME} (${attempt}/${MAX_GENERATION_ATTEMPTS})`
      );

      // Preserve API errors for the outer error handler.
      // This avoids hiding service failures as validation errors.
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: schema,
        },
      });

      // STEP 7: Parse the structured JSON.
      let parsed: unknown;

      try {
        parsed = JSON.parse(
          response.text ?? "{}"
        );
      } catch {
        console.warn(
          `Attempt ${attempt}: Gemini returned invalid JSON.`
        );

        continue;
      }

      // STEP 8: Validate structure, places, time, and budget.
      const result = validateGeneratedItinerary(
        parsed,
        maxMinutes,
        budgetLimit
      );

      if (result) {
        validated = result;
        break;
      }

      console.warn(
        `Attempt ${attempt}: itinerary failed validation.`
      );
    }

    // Both attempts failed validation.
    if (!validated) {
      return NextResponse.json(
        {
          error:
            "Could not generate a valid itinerary. Please try again.",
        },
        { status: 422 }
      );
    }

    const {
      generated,
      stops,
      totalMinutes,
      totalCost,
    } = validated;

    // STEP 9: Format a concise, readable guide.
    const stopSections = stops.map((stop, index) => {
      const cost =
        stop.estimatedCostUsd === 0
          ? "Free"
          : `~$${stop.estimatedCostUsd.toFixed(0)}`;

      const walk =
        stop.walkMinutesToNext > 0
          ? ` · ${stop.walkMinutesToNext} min walk`
          : "";

      return `${index + 1}. ${stop.place}
${formatDuration(stop.durationMinutes)} · ${cost}${walk}
${stop.activity}`;
    });

    const guide = [
      generated.tagline,
      `${formatDuration(totalMinutes)} · ~$${totalCost.toFixed(0)} estimated`,
      ...stopSections,
    ].join("\n\n");

    // STEP 10: Prepare locations for photo lookup.
    // Prioritize specific stops before neighborhood fallbacks.
    const photoPlace = stops[0].place;

    const photoPlaces = [
      ...stops.map((stop) =>
        stop.place.trim()
      ),
      ...stops.map((stop) =>
        stop.neighborhood.trim()
      ),
    ];

    // Remove duplicate and empty search terms.
    const uniquePhotoPlaces = Array.from(
      new Map(
        photoPlaces
          .filter(Boolean)
          .map((place) => [
            normalizePlaceName(place),
            place,
          ])
      ).values()
    );

    // STEP 11: Save the AI-generated SideQuest.
    const {
      data: sidequest,
      error: saveError,
    } = await supabase
      .from("sidequests")
      .insert({
        user_id: user.id,
        user_request: userRequest,
        title: generated.title.trim(),
        generated_guide: guide,
        is_published: false,
      })
      .select("id, title, generated_guide")
      .single();

    if (saveError || !sidequest) {
      console.error(
        "SideQuest save error:",
        saveError
      );

      return NextResponse.json(
        {
          error: "Could not save your SideQuest.",
        },
        { status: 500 }
      );
    }

    // STEP 12: Save the exact AI prompt and model.
    const {
      error: promptError,
    } = await supabase
      .from("sidequest_generation_prompts")
      .insert({
        sidequest_id: sidequest.id,
        user_id: user.id,
        prompt,
        model_name: MODEL_NAME,
      });

    if (promptError) {
      console.error(
        "Prompt save error:",
        promptError
      );

      // Remove the SideQuest if its prompt was not saved.
      const {
        error: cleanupError,
      } = await supabase
        .from("sidequests")
        .delete()
        .eq("id", sidequest.id);

      if (cleanupError) {
        console.error(
          "Cleanup error:",
          cleanupError
        );
      }

      return NextResponse.json(
        {
          error: "Could not save the generation prompt.",
        },
        { status: 500 }
      );
    }

    // STEP 13: Return the result to the frontend.
    return NextResponse.json({
      sidequest: {
        id: sidequest.id,
        title: sidequest.title,
        guide: sidequest.generated_guide,

        // First recommended location.
        photoPlace,

        // Places followed by neighborhood fallbacks.
        photoPlaces: uniquePhotoPlaces,

        // Retained for frontend compatibility.
        eventIds: [],
      },
    });
  } catch (error) {
    console.error(
      "SideQuest generation failed:",
      error
    );

    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 503
        ? 503
        : 500;

    return NextResponse.json(
      {
        error:
          status === 503
            ? "Gemini is temporarily busy. Please try again."
            : "Could not generate your SideQuest. Please try again.",
      },
      { status }
    );
  }
}
