import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase-server";

// Preserve the existing Gemini model.
const MODEL_NAME = "gemini-3.5-flash-lite";

// Allow up to three attempts with validation feedback.
const MAX_GENERATION_ATTEMPTS = 3;

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

type ValidationResult =
  | {
      valid: true;
      result: ValidatedItinerary;
    }
  | {
      valid: false;
      reason: string;
    };

// =========================================
// HELPER FUNCTIONS
// =========================================

// Format durations.
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;

  if (hours === 0) return `${minutes} min`;
  if (remaining === 0) return `${hours} hr`;

  return `${hours} hr ${remaining} min`;
}

// Count words.
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Extract the requested time limit.
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

// Extract the requested budget.
function getBudget(text: string): number | null {
  const match = text.match(
    /\$\s*(\d+(?:\.\d{1,2})?)/
  );

  return match ? Number(match[1]) : null;
}

// Identify budgets with an exclusive upper limit.
//
// Examples:
// "under $20" -> true
// "below $15" -> true
// "less than $10" -> true
// "up to $20" -> false
// "budget $0" -> false
//
// A $0 budget remains inclusive because
// spending cannot be less than $0.
function isStrictBudget(text: string): boolean {
  return /\b(?:under|below|less than)\s*\$?\s*(\d+(?:\.\d+)?)/i.test(
    text
  );
}

// Normalize destination names.
function normalizePlaceName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

// =========================================
// DESTINATION VALIDATION
// =========================================

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

// Known permanently closed destinations.
//
// This is a limited safeguard, not a live
// database of operating businesses.
//
// Add entries only when their closure has
// been independently confirmed.
const CLOSED_VENUES = new Set([
  "printed matter st marks",
  "printed matter st marks place",
  "printed matter st marks bookstore",
  "printed matter st marks shop",
  "printed matter st marks location",
  "printed matter 38 st marks place",
  "printed matter at st marks",
]);

function isKnownClosedVenue(place: string): boolean {
  const normalized = normalizePlaceName(place);

  if (CLOSED_VENUES.has(normalized)) {
    return true;
  }

  // Catch variations such as
  // "Printed Matter / St. Marks".
  return (
    normalized.includes("printed matter") &&
    (
      normalized.includes("st marks") ||
      normalized.includes("saint marks") ||
      normalized.includes("38 st marks")
    )
  );
}

// =========================================
// OPTIONAL SPENDING VALIDATION
// =========================================

// Identify an activity that clearly describes
// browsing without requiring a purchase.
//
// This is intentionally conservative:
// it should not reject actual food purchases,
// admission fees, or paid experiences.
function isFreeBrowsingActivity(
  activity: string
): boolean {
  const text = activity.toLowerCase();

  const browsingLanguage =
    /\b(browse|browsing|window[\s-]?shop|window[\s-]?shopping|look through|leaf through|peruse|flip through)\b/i.test(
      text
    );

  if (!browsingLanguage) {
    return false;
  }

  // If the activity explicitly includes
  // purchasing or consuming something,
  // do not treat it as free browsing.
  const requiredPurchaseLanguage =
    /\b(buy|purchase|pay for|order|eat|taste|sample|savor|enjoy a meal|grab a bite|pick up a snack|ticket|admission|entry fee)\b/i.test(
      text
    );

  return !requiredPurchaseLanguage;
}

// =========================================
// STRUCTURAL VALIDATION
// =========================================

// Validate Gemini's structured response.
//
// Short itineraries need shorter activities
// so that walking fits within the time limit.
function isValidItinerary(
  value: Partial<GeneratedItinerary>,
  minActivityMinutes: number
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
      stop.durationMinutes >= minActivityMinutes &&
      stop.durationMinutes <= 120 &&
      Number.isFinite(stop.estimatedCostUsd) &&
      stop.estimatedCostUsd >= 0 &&
      Number.isInteger(stop.walkMinutesToNext) &&
      stop.walkMinutesToNext >= 0 &&
      stop.walkMinutesToNext <= 30
  );
}

// =========================================
// ITINERARY VALIDATION
// =========================================

// Validate generated results and return
// specific feedback for Gemini retries.
function validateGeneratedItinerary(
  value: unknown,
  maxMinutes: number,
  budgetLimit: number | null,
  strictBudget: boolean
): ValidationResult {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {
      valid: false,
      reason: "The response was not a JSON object.",
    };
  }

  const candidate = value as Partial<GeneratedItinerary>;

  // Allow 10-minute activities for outings
  // lasting 45 minutes or less.
  const minActivityMinutes =
    maxMinutes <= 45 ? 10 : 15;

  // STEP A: Validate structure.
  if (
    !isValidItinerary(
      candidate,
      minActivityMinutes
    )
  ) {
    return {
      valid: false,
      reason:
        "The itinerary does not match the required structure. " +
        "Include exactly 2 or 3 stops, specific place names, " +
        `activity durations between ${minActivityMinutes} and 120 minutes, ` +
        "nonnegative costs, walking estimates between 0 and 30 minutes, " +
        "and 12–25 words per activity description.",
    };
  }

  // STEP B: Normalize the final walking segment.
  const stops = candidate.stops.map(
    (stop, index) => ({
      ...stop,
      walkMinutesToNext:
        index === candidate.stops.length - 1
          ? 0
          : stop.walkMinutesToNext,
    })
  );

  // STEP C: Check duplicate destinations.
  const placeNames = stops.map((stop) =>
    normalizePlaceName(stop.place)
  );

  if (
    new Set(placeNames).size !==
    placeNames.length
  ) {
    return {
      valid: false,
      reason:
        "The itinerary repeats a destination. " +
        "Choose distinct locations.",
    };
  }

  // STEP D: Reject generic destinations.
  if (
    placeNames.some((name) =>
      GENERIC_NAMES.has(name)
    )
  ) {
    return {
      valid: false,
      reason:
        "The itinerary includes a generic destination. " +
        "Use specific, recognizable places.",
    };
  }

  // STEP E: Reject known closed venues.
  const closedStop = stops.find((stop) =>
    isKnownClosedVenue(stop.place)
  );

  if (closedStop) {
    return {
      valid: false,
      reason:
        `"${closedStop.place}" is a known permanently closed venue. ` +
        "Replace it with an established destination " +
        "that is still operating. Do not recommend " +
        "the closed St. Marks location.",
    };
  }

  // STEP F: Reject unnecessary browsing costs.
  const paidBrowsingStop = stops.find(
    (stop) =>
      stop.estimatedCostUsd > 0 &&
      isFreeBrowsingActivity(stop.activity)
  );

  if (paidBrowsingStop) {
    return {
      valid: false,
      reason:
        `"${paidBrowsingStop.place}" has an estimated cost ` +
        `of $${paidBrowsingStop.estimatedCostUsd}, ` +
        "but the described activity only involves browsing. " +
        "Set estimatedCostUsd to 0 unless a purchase " +
        "is actually required for the activity.",
    };
  }

  // STEP G: Calculate total duration.
  const totalMinutes = stops.reduce(
    (sum, stop) =>
      sum +
      stop.durationMinutes +
      stop.walkMinutesToNext,
    0
  );

  // STEP H: Calculate estimated spending.
  const totalCost = stops.reduce(
    (sum, stop) =>
      sum + stop.estimatedCostUsd,
    0
  );

  // STEP I: Enforce the time limit.
  if (totalMinutes > maxMinutes) {
    return {
      valid: false,
      reason:
        `The itinerary takes ${totalMinutes} minutes, ` +
        `but the maximum is ${maxMinutes} minutes. ` +
        "Choose shorter activities or a more compact route. " +
        "Do not artificially shorten walking times.",
    };
  }

  // STEP J: Enforce the budget.
  //
  // Strict:
  // "under $20" rejects $20 or higher.
  //
  // Inclusive:
  // "up to $20" allows exactly $20.
  //
  // A $0 budget is treated as inclusive.
  const exceedsBudget =
    budgetLimit !== null &&
    (
      strictBudget && budgetLimit > 0
        ? totalCost >= budgetLimit
        : totalCost > budgetLimit
    );

  if (exceedsBudget) {
    const comparison =
      strictBudget && budgetLimit !== null && budgetLimit > 0
        ? "strictly less than"
        : "at most";

    return {
      valid: false,
      reason:
        `The estimated cost is $${totalCost}, ` +
        `but the requested budget requires spending ${comparison} $${budgetLimit}. ` +
        "Choose more affordable activities.",
    };
  }

  return {
    valid: true,
    result: {
      generated: candidate,
      stops,
      totalMinutes,
      totalCost,
    },
  };
}

// =========================================
// GENERATION ENDPOINT
// =========================================

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
          error:
            "Please sign in to create a SideQuest.",
        },
        { status: 401 }
      );
    }

    // STEP 2: Read and validate the request.
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
        {
          error: "Gemini API key is missing.",
        },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const timeLimit = getTimeLimit(userRequest);
    const budgetLimit = getBudget(userRequest);
    const strictBudget = isStrictBudget(userRequest);
    const maxMinutes = timeLimit ?? 240;

    if (maxMinutes < 30) {
      return NextResponse.json(
        {
          error:
            "Please allow at least 30 minutes for your SideQuest.",
        },
        { status: 400 }
      );
    }

    // Give Gemini a target below the hard limit.
    //
    // For a 30-minute outing, aim for around
    // 27 minutes while allowing up to 30.
    const targetMinutes = Math.min(
      maxMinutes,
      Math.max(
        20,
        Math.floor(maxMinutes * 0.9)
      )
    );

    const minActivityMinutes =
      maxMinutes <= 45 ? 10 : 15;

    // Describe the requested budget comparison.
    const budgetInstruction =
      budgetLimit === null
        ? "No specific budget limit was provided."
        : strictBudget && budgetLimit > 0
          ? `Total estimated activity spending MUST be strictly less than $${budgetLimit}.`
          : `Total estimated activity spending MUST NOT exceed $${budgetLimit}.`;

    // STEP 4: Create the generation instructions.
    const prompt = `
You are SideQuest NYC, a creative and practical
mini-itinerary planner for college students
exploring New York City.

STUDENT REQUEST:
${userRequest}

IMPORTANT CONSTRAINTS:
- Maximum duration: ${maxMinutes} minutes.
- Aim for approximately ${targetMinutes} minutes
  when practical, without exceeding the maximum.
- Include activity durations and walking times.
- Minimum activity duration:
  ${minActivityMinutes} minutes per stop.
- Maximum estimated activity spending:
  ${
    budgetLimit === null
      ? "No specified limit"
      : `$${budgetLimit}`
  }.
- Budget comparison:
  ${budgetInstruction}
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

IMPORTANT: GEOGRAPHIC ACCURACY

The itinerary must form one realistic,
geographically connected outing.

Do not choose destinations simply because
they are in the same borough.

New York City boroughs are large.
Two places in Queens, Brooklyn, or Manhattan
may be very far apart.

Choose destinations within a compact area
that can realistically be explored on foot.

For example:
- A downtown Flushing walking itinerary
  must not include a distant attraction
  elsewhere in Queens.
- A Greenwich Village walking itinerary
  should prioritize nearby streets
  and adjacent neighborhoods.
- A Roosevelt Island outing should use
  a logical route along the island.

These are examples, not location restrictions.
Follow the student's actual destination
and interests.

Do not assume that two places are nearby
because they share a borough or ZIP code.

For each pair of consecutive stops:
- Consider their actual physical locations.
- Consider the walking route between them.
- Prefer walking segments of 15 minutes
  or less.
- Avoid walking segments over 20 minutes
  unless necessary for the student's request.
- Never invent a short walking time to
  make distant destinations fit.

If two destinations would require a long
cross-borough journey, choose a closer
alternative.

Order destinations to minimize backtracking.

The final stop must have zero walking
minutes afterward.

Do not invent street addresses.

----------------------------------------
3. USER INTENT
----------------------------------------

Respect the student's requested:
- Neighborhood or borough
- Interests
- Available time
- Budget
- Preferred activity types

IMPORTANT: NEIGHBORHOOD ACCURACY

When the student explicitly requests a
specific NYC neighborhood, choose stops
located within that neighborhood.

Do not substitute venues in other
neighborhoods simply because they match
the same interests.

For example:
- An East Village request should not be
  fulfilled with venues in SoHo or
  Greenwich Village.
- A downtown Flushing request should not
  include distant locations in Queens.
- A DUMBO request should focus on actual
  DUMBO destinations.

These are examples, not restrictions.
Always follow the student's requested area.

Do not confuse nearby neighborhood names
with the requested neighborhood.

The neighborhood field for each stop
must describe its actual location.

Never change a neighborhood label
just to make a venue appear eligible.

If one proposed venue falls outside
the requested neighborhood, replace it
with an appropriate destination inside
the requested area.

If a broad borough is requested instead,
choose a compact neighborhood or a
cluster of genuinely adjacent areas.

If the student requests food,
recommend appropriate food experiences.

If the student requests history,
recommend historically interesting places.

If the student requests nature,
recommend parks, gardens, waterfronts,
or other suitable outdoor destinations.

Avoid adding attractions unrelated
to the student's main request.

If the student specifies dietary restrictions,
respect them in every food recommendation.

If the request does not specify a neighborhood,
choose one geographically compact area
that fits the student's interests.

Do not force every itinerary into Manhattan.

----------------------------------------
4. QUALITY AND VARIETY
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
5. TIME AND BUDGET
----------------------------------------

The combined duration of:
- All activities
- All walking segments

MUST fit within ${maxMinutes} minutes.

Aim for approximately ${targetMinutes}
minutes when practical.

Leave a small time buffer rather than
planning every minute of the maximum.

Never exceed ${maxMinutes} minutes.

SHORT OUTINGS:

For outings of 30 to 45 minutes,
individual activities may last
10 to 15 minutes.

Choose nearby locations and allow
realistic time to walk between them.

For a 30-minute request, prefer
exactly 2 nearby stops.

A short photography outing may
include two distinct landmarks
within the same park or neighborhood.

For example, a park entrance,
historic arch, fountain, or nearby
architectural landmark can be
a separate photography destination.

Do not use the same destination
twice under different names.

Do not invent zero-minute walking
times between physically separate stops.

The combined duration must include
all walking between destinations.

Do not shorten walking estimates
just to satisfy the time limit.

Choose a more compact route instead.

When practical, make reasonable use
of the available time without exceeding it.

IMPORTANT: ACCURATE ACTIVITY COSTS

Estimate the cost required to complete
the recommended activity.

Do not include optional purchases
in the required estimated cost.

Examples:
- Browsing a bookstore without buying
  anything costs $0.
- Browsing a record shop without buying
  anything costs $0.
- Browsing a supermarket without
  purchasing anything costs $0.
- Viewing architecture from a public
  street costs $0.
- Walking through a free public park
  costs $0.
- Enjoying a free scenic viewpoint
  costs $0.

If a food purchase, admission ticket,
or other paid activity is essential
to the experience, include its
reasonable estimated cost.

For food experiences:
- If the activity involves eating,
  tasting, ordering, or purchasing food,
  include a realistic estimated cost.
- Do not label a meal or purchased
  snack as free.
- If the activity only involves
  browsing a market, the cost is $0.

Do not automatically assign $15 or $20
to a shop merely because visitors
could choose to purchase something.

If the budget is $0, every recommended
activity must genuinely be free and
every stop must have
estimatedCostUsd equal to 0.

STRICT BUDGETS:

If the student says "under $20",
"below $20", or "less than $20",
the total estimated cost must be
strictly less than $20.

A total of exactly $20 is NOT valid
for a request saying "under $20".

If the student says "up to $20"
or "maximum $20", a total of
exactly $20 is allowed.

For this request:
${budgetInstruction}

The total estimated activity cost
MUST respect the student's budget.

If no budget is specified,
avoid unnecessary spending.

If the user requests a low-cost outing,
prioritize free or affordable experiences.

Treat all prices as estimates.

----------------------------------------
6. ACCURACY AND ACCESSIBILITY
----------------------------------------

Recommend plausible, real NYC locations.

Prefer destinations that are generally
accessible to ordinary visitors.

IMPORTANT: BUSINESS ACCURACY

Use established destinations that
you can confidently identify.

Do not invent businesses simply to
match a particular activity type.

Do not recommend businesses whose
current existence or operating status
is uncertain when a more established
alternative is available.

Avoid:
- Permanently closed venues
- Private or restricted locations
- Attractions requiring special access
- Places that cannot reasonably be visited
  during a normal outing

KNOWN CLOSED LOCATION:

Printed Matter / St. Marks, formerly
located at 38 St. Marks Place, has closed.

Do not recommend this former location
as an operating bookstore.

This is a known example, not an
exhaustive list of closed businesses.

Do not assume that visitors can enter
historic ruins or restricted buildings.

If a site is primarily viewed from outside,
describe it as an exterior visit.

Do not invent:
- Events
- Exhibitions
- Performances
- Opening hours
- Ticket availability
- Street addresses

Do not claim to have verified live information.

Treat costs and walking times as estimates.

When a destination's current availability
is uncertain, prefer a more established
publicly accessible alternative.

----------------------------------------
7. TITLE
----------------------------------------

Create a short, distinctive, appealing title.

Avoid generic names such as:
- NYC Adventure
- Explore Manhattan
- Fun Day in New York

Avoid repetitive words.

Only mention experiences actually
included in the itinerary.

Do not promise temples, museums,
food experiences, or activities
that are absent from the stops.

----------------------------------------
8. TAGLINE
----------------------------------------

Write one tagline of at most 6 words.

Capture the atmosphere or overall
appeal of the outing.

Do not repeat the title.

Avoid generic phrases and filler.

----------------------------------------
9. EACH STOP
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
10. INTERNAL ROUTE CHECK
----------------------------------------

Before returning the itinerary,
carefully review all proposed stops.

Ask yourself:

1. Are these specific, real destinations?

2. Are they within the requested
   neighborhood, when one is specified?

3. Are the neighborhood labels accurate?

4. Could someone realistically walk
   between consecutive stops?

5. Are the estimated walking times
   geographically plausible?

6. Does the route avoid unnecessary
   backtracking?

7. Is every stop relevant to the
   student's interests?

8. Are the destinations reasonably
   accessible to ordinary visitors?

9. Does the total outing fit the
   requested time and budget?

10. Are optional purchases excluded
    from required activity costs?

11. Are actual purchases included
    when necessary?

12. Are any venues known to be closed
    or potentially nonexistent?

13. Does the title accurately describe
    the actual stops?

If any answer is no or uncertain,
replace the problematic destination
or revise the activity.

Perform this check internally.
Do not include the checklist
in the response.

----------------------------------------
11. WRITING STYLE
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
12. OUTPUT
----------------------------------------

Return ONLY valid JSON matching
the supplied response schema.
`;

    // STEP 5: Define the response schema.
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

    // =========================================
    // GENERATE AND VALIDATE
    // =========================================

    let validated: ValidatedItinerary | null = null;
    let retryFeedback = "";

    for (
      let attempt = 1;
      attempt <= MAX_GENERATION_ATTEMPTS;
      attempt++
    ) {
      console.log(
        `Generating SideQuest with ${MODEL_NAME} (${attempt}/${MAX_GENERATION_ATTEMPTS})`
      );

      // Explain previous validation problems
      // to Gemini on subsequent attempts.
      const attemptPrompt = retryFeedback
        ? `${prompt}

----------------------------------------
RETRY INSTRUCTIONS
----------------------------------------

The previous generated itinerary was rejected.

REASON:
${retryFeedback}

Generate a NEW itinerary that fixes
this specific problem.

Reconsider your destination choices,
activity durations, estimated costs,
and route.

Ensure that every activity lasts
at least ${minActivityMinutes} minutes.

Ensure that the total duration,
including walking, does not exceed
${maxMinutes} minutes.

${budgetInstruction}

Do not simply repeat the previous response.

Return only valid JSON matching the schema.
`
        : prompt;

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: attemptPrompt,
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: schema,
        },
      });

      // STEP 6: Parse the response.
      let parsed: unknown;

      try {
        parsed = JSON.parse(response.text ?? "{}");
      } catch {
        retryFeedback =
          "The response was not valid JSON.";

        console.warn(
          `Attempt ${attempt}: invalid JSON.`
        );

        continue;
      }

      // STEP 7: Validate the itinerary.
      const validation = validateGeneratedItinerary(
        parsed,
        maxMinutes,
        budgetLimit,
        strictBudget
      );

      if (validation.valid) {
        validated = validation.result;
        break;
      }

      retryFeedback = validation.reason;

      console.warn(
        `Attempt ${attempt}: ${retryFeedback}`
      );
    }

    // Return an error if every attempt failed.
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

    // =========================================
    // FORMAT ITINERARY
    // =========================================

    // STEP 8: Format the itinerary.
    const stopSections = stops.map(
      (stop, index) => {
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
      }
    );

    const guide = [
      generated.tagline,
      `${formatDuration(totalMinutes)} · ~$${totalCost.toFixed(0)} estimated`,
      ...stopSections,
    ].join("\n\n");

    // =========================================
    // PHOTO SEARCH LOCATIONS
    // =========================================

    // STEP 9: Prepare photo search locations.
    const photoPlace = stops[0].place;

    const photoPlaces = [
      ...stops.map((stop) =>
        stop.place.trim()
      ),
      ...stops.map((stop) =>
        stop.neighborhood.trim()
      ),
    ];

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

    // =========================================
    // SAVE TO SUPABASE
    // =========================================

    // STEP 10: Save the generated SideQuest.
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
          error:
            "Could not save your SideQuest.",
        },
        { status: 500 }
      );
    }

    // STEP 11: Save the exact prompt and model.
    const { error: promptError } =
      await supabase
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

      const { error: cleanupError } =
        await supabase
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
          error:
            "Could not save the generation prompt.",
        },
        { status: 500 }
      );
    }

    // =========================================
    // RETURN GENERATED SIDEQUEST
    // =========================================

    // STEP 12: Return the result.
    return NextResponse.json({
      sidequest: {
        id: sidequest.id,
        title: sidequest.title,
        guide: sidequest.generated_guide,
        photoPlace,
        photoPlaces: uniquePhotoPlaces,
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
