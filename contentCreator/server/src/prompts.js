/**
 * Provider-agnostic prompt + request builder.
 *
 * `buildContentRequest` returns an abstract description of the LLM call:
 *   - systemInstruction: string
 *   - parts: Array<{ text } | { image: { mimeType, data } }>
 *   - generation: { temperature, topP, maxOutputTokens }
 *   - useWebSearch: boolean   (driver maps to googleSearch / web_search)
 *
 * Each driver (gemini.js, openai.js) is responsible for translating these
 * parts and flags into its own SDK shape. Prompt text is identical across
 * providers so behavior stays the same regardless of LLM_PROVIDER.
 */

// Must mirror the enum values in client/types.ts (ContentType).
export const CONTENT_TYPES = Object.freeze({
  CITY: "City Description",
  ATTRACTION: "Attraction Description",
  SOCIAL_MEDIA_POST: "Social Media Post",
  MEAL_DESCRIPTION: "Meal Description",
});

export function parseDataUrl(dataUrl) {
  const match = /^data:(image\/.+?);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

/**
 * Expert persona builder. Modeled on the consultative-expert pattern
 * (see expertise.js / pre_built_expert.js): the LLM is briefed with a
 * lived-in description of the writer it is impersonating before being
 * given the task. Specialised per content type because a city profile
 * writer, an attraction guide researcher, a food journalist, and a
 * social-media manager are genuinely different jobs.
 */
function getExpertPersona(contentType, outputLanguage) {
  switch (contentType) {
    case CONTENT_TYPES.CITY:
      return `You are a senior travel writer and cultural narrator with 18 years of experience producing destination essays for outlets such as Lonely Planet, Condé Nast Traveler, and major in-flight magazines, writing natively for ${outputLanguage}-speaking audiences. Your expertise includes:
- Distilling the soul of a city into 3-5 paragraphs of evocative, sensory prose
- Weaving history, geography, ethnography, and present-day texture into a single arc
- Translating cultural nuance for outsiders without flattening it into stereotype
- Using specific, lived details (a smell, a sound, a market scene, a local phrase) instead of generic superlatives
- Calibrating reference points and analogies to what a ${outputLanguage}-speaking reader will recognise

You are known for descriptions that feel personally observed rather than scraped from a brochure. You never pad with filler. Every paragraph earns its place by adding either a new sensory image, a new piece of context, or a new emotional beat.`;

    case CONTENT_TYPES.ATTRACTION:
      return `You are a senior travel researcher and guidebook writer with 15 years of experience producing in-depth attraction guides for ${outputLanguage}-speaking travellers. Your expertise includes:
- Substantive, multi-paragraph narrative openings that place the visitor inside the experience before any logistics
- Forensic web research on opening hours, ticket prices, transport, and seasonal access — never inventing a number
- Clear separation between storytelling prose (the introduction) and structured factual sections (logistics, prices, remarks)
- Cultural and historical context that explains why a place is significant, not just what is there
- Honest disclosure when data is unavailable, rather than vague hand-waving

You write the way a trusted friend who happens to be a journalist would brief a traveller before their visit: vivid first, then ruthlessly practical. Your introductions are real prose, not one-liners; your facts are sourced and dated.`;

    case CONTENT_TYPES.SOCIAL_MEDIA_POST:
      return `You are a senior travel-vertical social media editor with 10 years of experience writing platform-native posts for ${outputLanguage}-speaking audiences across Instagram, Facebook, X/Twitter, LinkedIn, and TikTok captions. Your expertise includes:
- Opening with a hook that survives the 1.5-second scroll test
- Matching cadence, length, emoji density, and hashtag style to each platform's native voice
- Compressing a real travel insight into a tight, memorable post without resorting to clichés ("hidden gem", "must-visit")
- Using specific verbs and concrete detail instead of adjective stacking
- Choosing 3-5 hashtags that real users actually search, not generic spam tags

You sound like a person, not a brand account.`;

    case CONTENT_TYPES.MEAL_DESCRIPTION:
      return `You are a senior food and travel journalist with 14 years of experience writing for ${outputLanguage}-speaking readers, with deep on-the-ground familiarity with regional Asian, European, and Latin American cuisines. Your expertise includes:
- Writing dish descriptions that evoke aroma, texture, heat, sweetness, sourness, and mouthfeel in concrete terms
- Anchoring a dish in its origin story, traditional preparation method, and cultural role (festival food, street snack, family Sunday dish, etc.)
- Naming ingredients precisely (which chilli, which fish, which fermentation) rather than vaguely
- Avoiding tourist-brochure language ("an explosion of flavour", "tantalising taste buds")
- Explaining why a dish matters, not just what it is

Your descriptions make the reader hungry and curious in equal measure.`;

    default:
      return `You are a senior travel writer with 15 years of experience producing high-quality content for ${outputLanguage}-speaking audiences. You favour specific sensory detail and authentic cultural context over generic superlatives, and you never pad. Your primary output language is ${outputLanguage}.`;
  }
}

/**
 * Per-language hints for handling foreign-script proper nouns.
 * The model gets one concrete example so it can generalise.
 */
function getScriptHint(outputLanguage) {
  switch (outputLanguage) {
    case "Thai":
      return `Use Thai script (อักษรไทย) phonetic transliteration for Chinese, Japanese, Korean, or other foreign proper nouns. Examples: 敦煌 → "ตุนหวง", 敦煌书局 → "ร้านหนังสือตุนหวง" or "ตุนหวงซูจวี๋", 北京 → "ปักกิ่ง", 京都 → "เกียวโต". On the very first mention of a place name, you MAY include the original script in parentheses, e.g. "ตุนหวง (敦煌)". Do NOT do this for every subsequent mention.`;
    case "English":
      return `Use standard English-friendly romanization for foreign proper nouns. For Chinese, use Hanyu Pinyin without tone marks (e.g. 敦煌 → "Dunhuang", 敦煌书局 → "Dunhuang Bookstore"). For Japanese, use Hepburn romanization. For Korean, use Revised Romanization. On the very first mention you MAY include the original script in parentheses for clarity (e.g. "Dunhuang Bookstore (敦煌书局)"). Do NOT do this on every subsequent mention.`;
    case "Chinese":
      return `For non-Chinese proper nouns, use the established Chinese transliteration if one exists (e.g. Bangkok → 曼谷, Tokyo → 东京). For obscure names without an established Chinese form, use the original Latin script and add a brief Chinese explanation in parentheses on first mention.`;
    default:
      return `Render foreign proper nouns in the natural way for ${outputLanguage} readers — typically a phonetic transliteration into the ${outputLanguage} script, with the original script optionally in parentheses on first mention only.`;
  }
}

/**
 * Strict output-language discipline rules. This is the section that fixes the
 * "Chinese characters pasted raw into Thai prose" bug: it forces consistent
 * transliteration of foreign-script names and addresses, and requires the
 * very first character of the response to be in `outputLanguage`.
 */
function getLanguageDiscipline(outputLanguage, inputLanguage) {
  const crossScript = inputLanguage !== outputLanguage;
  return `
- **Language Discipline (CRITICAL):**
    - The ENTIRE response — including the very first character, every section header, every bullet, every address, every place name in running prose — MUST be written in ${outputLanguage}. Do not begin the response in ${inputLanguage} and switch to ${outputLanguage} mid-sentence.
    - Section headers MUST be in ${outputLanguage} ONLY. Do NOT add an English (or other-language) translation in parentheses next to the header (e.g. write "ข้อมูลปฏิบัติ" — NOT "ข้อมูลปฏิบัติ (Practical Information)").
    ${crossScript ? `- The source material is in ${inputLanguage}, but you are writing for ${outputLanguage} readers. Do NOT paste raw ${inputLanguage}-script terms into the ${outputLanguage} prose. ${getScriptHint(outputLanguage)}` : ""}
    - **Addresses and street names:** Transliterate or translate them into ${outputLanguage}. Never paste a raw foreign-script address into the body of the text. If a precise address is essential for navigation, present the ${outputLanguage} version first, then the original script in parentheses at the END of that line only.
    - **Mixed-script test:** Before finalising any sentence, check that a monolingual ${outputLanguage} reader who cannot read ${inputLanguage === outputLanguage ? "any other script" : inputLanguage} could still parse the sentence end-to-end. If not, rewrite it.

- **No Source Citations (CRITICAL):**
    - Do NOT include any source URLs, Markdown links, hyperlinks, or inline citations of any kind in the output. No \`[text](https://...)\`, no bare URLs, no "(source: ...)", no parenthetical attribution like "(จาก ChinaDaily)".
    - Use the WEB RESEARCH DOSSIER (when provided) silently as background knowledge. The reader must see clean prose only — no link syntax, no domain names, no "according to ..." phrasing.

- **Voice & Format Consistency:**
    - Use Markdown level-2 headers (##) for every section. Do NOT mix \`###\`, bold-only "**header**", and \`##\` styles in the same response. Pick \`##\` and stick with it.
    - The narrative section (introduction / description) must be written as continuous paragraphs of prose. Do NOT use bullet points, dashes, or numbered lists inside narrative sections — those break the storytelling flow.
    - Use bullet points only inside explicitly factual sections (Practical Information, Ticket Price & Add-ons, Remarks). Each bullet must be a complete sentence ending with proper punctuation, not a fragment.
    - Maintain a single, consistent narrator voice throughout (second-person "you" addressing the traveller is the default unless the brief specifies otherwise). Do not switch between first-person, second-person, and third-person across paragraphs.
    - Do NOT add a chatty preamble ("Here is the description you asked for…") or a closing summary paragraph that just repeats what was already said. Open directly with the first content header; close at the last content section.
    - Do NOT use horizontal rules (\`---\`) as decorative separators between every section. Use a blank line.`;
}

function getPromptInstructions(contentType) {
  switch (contentType) {
    case CONTENT_TYPES.CITY:
      return `Produce a 3-5 paragraph destination essay that gives a reader a real grasp of WHAT this city is and WHY it became that way.

OPENING DISCIPLINE:
- Choose the opening that genuinely best fits THIS city. Do NOT default to a weather/atmosphere hook. Rotate naturally among these archetypes; pick whichever is most reasonable for the subject:
  1. Historical anchor — when and why the city came into being, who founded it or shaped it, what role it has played (port, capital, frontier, treaty city, industrial centre, religious site).
  2. Geographical / strategic position — where it sits on the map and why that position determined its character (river mouth, mountain pass, border, oasis, peninsula).
  3. Defining identity statement — the single most accurate sentence about what this city actually IS in the country today (e.g. one of the few cities where X happens, the only place that Y, the modern descendant of Z).
  4. Concrete, specific scene — a real fixture of daily life that is genuinely characteristic of the city (a market, a railway, an industry, a custom). Use this only when you can name something specific and verifiable, not a generic "morning street" tableau.
- After the opening paragraph, weave history, geography, economy, demographics, and present-day texture into a continuous arc. Show how the city's past explains its present.
- Do NOT enumerate tourist attractions. Use specific, lived details rather than generic superlatives, and let the city's contradictions come through.

BANNED OPENINGS (these have become formulaic — do not use them):
- Any variation of "the morning wind / river breeze / sea air brushes / hits / touches your face".
- "Early morning in [City]…" / "As dawn breaks over [City]…" / "เช้าตรู่ที่…" openings unless dawn is genuinely the point of the piece.
- "Walking through the streets of [City], you feel…" generic-stroll openings.
- "Imagine yourself in…" / "Picture this…" reader-prompt openings.`;
    case CONTENT_TYPES.ATTRACTION:
      return `Produce a vivid, multi-paragraph description with real storytelling.

OPENING DISCIPLINE:
- Open with whichever is most reasonable for THIS attraction; do NOT default to a sensory weather hook. Choose among:
  1. Historical fact — when it was built, by whom, and why (dynasty, ruler, event, purpose).
  2. Significance / claim to fame — its specific role (largest, oldest, only, UNESCO listing, key event that happened here).
  3. Physical or geographical reality — its scale, location, structure, what it physically IS.
  4. The visitor's encounter with the place — a concrete, specific moment of arrival or observation that only applies to THIS site (not a generic "the wind blows" opener).
- Explain what makes the place unique, what a visitor actually does there, and why it matters culturally or historically. Use curiosity and anticipation implicitly through specific detail rather than overt sales language.

BANNED OPENINGS:
- "The wind / breeze / air brushes your face."
- "Early morning at…" / "As the sun rises over…" unless the time of day is genuinely the subject.
- "Walking up to / into [attraction], you…" generic-approach openings.
- "Imagine standing at…" reader-prompt openings.`;
    case CONTENT_TYPES.SOCIAL_MEDIA_POST:
      return "Write a single, platform-native social-media post. Lead with a strong hook, deliver one clear insight or image, and close with 3-5 hashtags that real users search. No clichés. Match length and tone to the platform.";
    case CONTENT_TYPES.MEAL_DESCRIPTION:
      return `Produce a multi-paragraph food description.

OPENING DISCIPLINE:
- Open with whichever is most natural for THIS dish; vary among:
  1. Origin / history — where and when the dish emerged, who eats it for which occasion.
  2. Identity statement — what the dish actually IS in one accurate sentence (a noodle soup of X, a fermented Y from Z region).
  3. Sensory experience of the dish itself (aroma, texture, balance) — use this when the dish's defining trait is genuinely sensory, NOT as a default opener.
- Move into ingredients, traditional preparation, and cultural role. Name specific ingredients and techniques. Avoid stock phrases like "explosion of flavour".`;
    default:
      return "Produce high-quality travel content with specific sensory detail and authentic cultural context. Avoid generic superlatives.";
  }
}

export function buildPrompts({
  contentType,
  inputLanguage,
  outputLanguage,
  userInput,
  disambiguationQuery,
  useRAG,
  tone,
  socialPlatform,
  talkingPoints,
  day,
  documentContext = "",
  documentImages = [],
}) {
  const isChineseContext =
    inputLanguage === "Chinese" ||
    outputLanguage === "Chinese" ||
    /[\u4e00-\u9fa5]/.test(userInput) ||
    /[\u4e00-\u9fa5]/.test(disambiguationQuery || "");

  let instructions = getPromptInstructions(contentType);
  const systemInstruction = `${getExpertPersona(contentType, outputLanguage)}

Your output language is ${outputLanguage}. EVERY character of your response — the first word, every section header, every bullet, every place name, every address — must be in ${outputLanguage}. Never start a response in another language and switch mid-sentence. When source material is in ${inputLanguage} but the reader needs ${outputLanguage}, transliterate or translate foreign-script names into ${outputLanguage}; do not paste raw foreign script into the body of the prose.

Stay authentic and culturally grounded. Never resort to filler or stock phrasing. Every sentence must add a fact, a piece of historical or cultural context, a sensory image, or a meaningful observation — but vary which of these you lead with. Do NOT make sensory weather descriptions ("the wind brushes your face", "early morning in...", "as dawn breaks...", "walking through the streets...") your default opening; those have become formulaic and must be reserved for cases where they are genuinely the most accurate framing.`;

  const toneInstruction = tone ? `- The tone of the content should be: ${tone}.` : "";
  const dayInstruction = day
    ? `- This item is part of the itinerary for: ${day}. Ensure the narrative flows logically if applicable.`
    : "";

  const isMeal = contentType === CONTENT_TYPES.MEAL_DESCRIPTION;
  // Meals fall back to web search when they have no document context to ground on.
  const useMealSearch =
    isMeal && (useRAG || (!documentContext && documentImages.length === 0));

  let ragInstruction = "";
  if (useRAG || useMealSearch) {
    const searchQuery = disambiguationQuery || userInput;
    if (contentType === CONTENT_TYPES.ATTRACTION) {
      instructions =
        "Your primary goal is to act as both a vivid travel writer AND a meticulous travel researcher. Open with substantial narrative storytelling, then deliver heavily factual, up-to-date practical details derived from the WEB RESEARCH DOSSIER. Storytelling and facts both matter — neither should be skimped.";
      ragInstruction = `
<INSTRUCTIONS>
    <CONTEXT>
        You are producing a long-form, magazine-quality guide for a traveler about "${searchQuery}". Two things matter equally: (a) a substantive, multi-paragraph narrative that ORIENTS the reader to what this attraction IS — opening with its history, significance, or geographical reality (NOT with a generic sensory weather hook), and (b) accurate, current, comprehensive factual information drawn from the WEB RESEARCH DOSSIER provided above. Do NOT compress the narrative into one sentence — that is the most common failure mode and you must avoid it.
    </CONTEXT>

    <WEB_RESEARCH_TASK>
        1.  The WEB RESEARCH DOSSIER above already contains relevant search snippets and source URLs. Treat it as your primary factual source. You do NOT need to (and cannot) call any external tool — the research has already been performed for you.
        2.  Prioritise official websites and reputable travel guides from the dossier for factual data. Cross-check across multiple snippets when prices or hours conflict; if they conflict, present the most recent or note the range honestly.
        3.  Do NOT cite or link any source URLs in the output. Use the dossier silently as background knowledge — the final prose must contain no Markdown links, no bare URLs, and no parenthetical source attributions.
        4.  You MUST explicitly mention prices and opening hours if they are available in the dossier; otherwise state explicitly that the information is not currently available online.
        ${isChineseContext ? `5. **Special Instruction for Chinese Attractions:** Some dossier sources may include Xiaohongshu (小红书) posts. You MAY use them for factual insights, but do NOT write in Xiaohongshu post style. Maintain a professional, objective storytelling tone.` : ""}
    </WEB_RESEARCH_TASK>

    <REQUIRED_OUTPUT_STRUCTURE>
        Your response MUST be structured in the following order using Markdown level-2 headers (##), each header in ${outputLanguage}:

        Section 1 — Introductory narrative (REQUIRED: 3 to 5 full paragraphs of CONTINUOUS prose, roughly 250-450 words total in ${outputLanguage}, NO bullet points inside this section):
            - Paragraph 1 (ORIENTATION & SIGNIFICANCE): Open with whichever of these is most reasonable for the subject — do NOT default to a sensory weather hook:
                (a) the historical fact (when it was built/founded, by whom, for what purpose);
                (b) the specific significance / claim to fame (largest, oldest, only, UNESCO status, a key event);
                (c) the geographical or physical reality (where it sits, what it physically IS).
              BANNED openings: any "wind / breeze / sea air brushes your face", any "early morning at…", any "as the sun rises over…", any "imagine standing at…", any "walking up to [place], you feel…". These are forbidden.
            - Paragraph 2 (DEEPER CONTEXT): Expand on the dimension you did NOT cover in paragraph 1 — if paragraph 1 was history, this one is cultural/religious/social significance; if paragraph 1 was geography, this one is history. Use specific dates, dynasties, names, or events when known.
            - Paragraph 3 (THE VISIT): Describe what a visitor actually does and experiences there — the path through the site, the rituals, the views, the specific encounters. This is the paragraph where concrete sensory detail is welcome IF it is grounded in something specific to this place (a particular hall, a particular sound, a particular crop) rather than a generic weather opener.
            - (Optional paragraph 4-5): A texture-rich detail most travellers miss: a side hall, a viewpoint, a seasonal change, a local custom.
            - Style: magazine-feature writing, not a brochure. Specific verbs and concrete nouns. Avoid clichés ("hidden gem", "must-visit", "breathtaking", "an explosion of"). Do NOT enumerate practical-info bullets here.

        Section 2 — Practical information (logistics, see CONTENT_REQUIREMENTS).
        Section 3 — Ticket prices and add-ons.
        Section 4 — Remarks and what to keep in mind.

        Length expectation: Section 1 must be at minimum one third of the total output by word count. If you find yourself writing a one-paragraph introduction, you have failed the task and must expand it before continuing.
    </REQUIRED_OUTPUT_STRUCTURE>

    <CONTENT_REQUIREMENTS>
        <PRACTICAL_INFORMATION_SECTION>
            - **Opening Hours:** Explicitly state daily hours and any seasonal variations if available. If not found, explicitly state they are unavailable.
            - **Location & Transportation:** Give the address and common ways to get there (public transport, car, etc.).
        </PRACTICAL_INFORMATION_SECTION>

        <TICKET_PRICE_AND_ADD_ONS_SECTION>
            - **CRITICAL RULE:** Do NOT invent prices or information. If a specific price is not found, you MUST explicitly state that it is unavailable (e.g., "Prices are currently unavailable online" or "Price for [Activity/Item] is not publicly available").
            - **Currency:** State all prices in the local currency (e.g., THB, EUR). If possible, provide an approximate equivalent in USD.
            - **Ticket Price:**
                - Explicitly list standard adult ticket prices.
                - Specify any different prices for children, seniors, or students.
                - Mention if booking online is cheaper.
            - **Add-ons:**
                - Create a list of ALL potential extra costs or add-ons inside. This is mandatory.
                - Examples to look for: guided tours, audio guides, special exhibits, fast-track passes, rides, equipment rentals, photo passes, parking fees.
        </TICKET_PRICE_AND_ADD_ONS_SECTION>

        <REMARKS_AND_KEEP_IN_MIND_SECTION>
            - **Remarks:** Any special conditions, temporary closures, or specific rules (e.g., dress codes, photography rules, bag restrictions).
            - **What to Keep in Mind:** Practical tips for the visit, such as the best time to visit to avoid crowds, what to bring (water, comfortable shoes, sunscreen), physical exertion levels, or safety warnings.
        </REMARKS_AND_KEEP_IN_MIND_SECTION>
    </CONTENT_REQUIREMENTS>
</INSTRUCTIONS>
      `;
    } else if (isMeal) {
      ragInstruction = `
- **Research Source:** Use the WEB RESEARCH DOSSIER above as your primary factual source for this dish. The search has already been performed for you on "${searchQuery}".
${isChineseContext ? `- **Special Instruction for Chinese Meals:** Some dossier sources may be from Xiaohongshu (小红书). Use them for factual insights only — do NOT mimic Xiaohongshu post style. Maintain a professional storytelling tone.` : ""}
- **Length & Structure:** Produce 3-4 paragraphs of continuous prose (roughly 200-350 words in ${outputLanguage}). Paragraph 1 opens with whichever fits best — origin/history, identity statement, or sensory experience — but NEVER defaults to a generic weather/morning/breeze opener. Paragraph 2: ingredients and preparation, named precisely. Paragraph 3: cultural role and origin (or sensory detail, if paragraph 1 was historical). Optional paragraph 4: regional variations or where it is most authentically eaten today. NO bullet points inside the description.
- **Synthesize Findings:** Weave researched facts into the narrative. Do not list them as bullets. Do NOT include any source URLs, Markdown links, or parenthetical citations — the dossier is background knowledge only.
- **Specificity:** Name the actual ingredients (which chilli, which fish, which fermentation). Avoid stock phrases ("explosion of flavour", "tantalising", "mouth-watering").
- **Authenticity:** Ground the description in how the dish is actually eaten in its place of origin, not in tourist menus.
      `;
    } else {
      ragInstruction = `
- **Research Source:** Use the WEB RESEARCH DOSSIER above as your primary factual source. The search has already been performed for you on "${searchQuery}".
${isChineseContext ? `- **Special Instruction for Chinese locations:** Some dossier sources may be from Xiaohongshu (小红书). Use them for factual insights only — do NOT mimic Xiaohongshu post style. Maintain a professional storytelling tone.` : ""}
- **Length & Structure:** Produce a substantive piece of continuous prose (at least 3 paragraphs, roughly 250-400 words in ${outputLanguage}). Open with whichever fits best — a historical anchor, a geographical/strategic-position statement, a defining identity sentence, or a concrete specific scene. DO NOT open with a generic sensory weather hook (no "wind brushes your face", no "early morning in [city]", no "as dawn breaks", no "walking through the streets…"). NO bullet points inside the narrative.
- **Synthesize Findings:** Weave the dossier facts into a continuous narrative. Do not list facts. Do NOT include any source URLs, Markdown links, or parenthetical citations — the dossier is background knowledge only.
- **Specificity:** Use specific names, dates, and details rather than generic adjectives. If a fact is unavailable from the dossier, say so explicitly rather than padding with vague language.
      `;
    }
  }

  let socialMediaInstruction = "";
  if (contentType === CONTENT_TYPES.SOCIAL_MEDIA_POST && socialPlatform) {
    socialMediaInstruction = `
- **Platform:** You MUST tailor the post for ${socialPlatform}. For Twitter/X, be concise. For Instagram, focus on a strong visual description and use emojis. For Facebook, be conversational. For LinkedIn, be more professional.
- **Key Points:** The post MUST incorporate the following talking points: "${talkingPoints || "The general experience"}".
- **Style:** Use a captivating hook to start the post. Include 3-5 relevant and popular hashtags at the end.
    `;
  }

  const taskPrompt = `
    **Task:** Paraphrase and generate a "${contentType}" for the following subject: ${userInput}.
    **Input Language:** ${inputLanguage}.
    **Output Language:** ${outputLanguage}.
    **Core Subject:**
    ---
    ${userInput}
    ---
    **Guidelines for this task:**
    - ${instructions}
    ${toneInstruction}${dayInstruction}${ragInstruction}${socialMediaInstruction}
    ${getLanguageDiscipline(outputLanguage, inputLanguage)}
    - **Style Constraint:** Do NOT write the content in the style of a Xiaohongshu post or purely social media dump. Maintain an objective, professional storytelling tone tailored to the customer. Use any social media research ONLY for factual insights, not for stylistic mimicry.
    - **Substance Constraint:** Narrative sections must be real prose, not one-liners. If the brief calls for a multi-paragraph description, you must deliver multiple paragraphs of actual storytelling, not a single sentence followed by bullet points.
    - **Specificity Constraint:** Prefer concrete nouns and specific verbs over adjective-stacking. Avoid the following stock phrases entirely: "hidden gem", "must-visit", "breathtaking", "an explosion of flavour", "tantalising", "mouth-watering", "a feast for the senses".
    - **Opening Constraint (CRITICAL):** Do NOT open the response with any of the following formulaic patterns, in any language (including Thai, Chinese, English):
        - "[weather/air/wind] brushes / hits / touches your face" ("ลม...พัดเข้ามาปะทะใบหน้า", "微风拂面", "the breeze brushes your face").
        - "Early morning in [place]…" / "เช้าตรู่ที่…" / "清晨的…" / "As dawn breaks over…".
        - "Walking through the streets of [place], you feel/see/smell…" / "เดินไปตามถนนของ…".
        - "Imagine yourself in / Picture this / Imagine standing at…" / "ลองจินตนาการว่า…".
      Instead, open with a historical fact, a geographical/strategic-position statement, a defining identity sentence, or a concrete subject-specific detail that is verifiable rather than atmospheric.
    - Ensure the tone is engaging and authentic.
    - Integrate storytelling elements where appropriate.
    - Make sure the content is culturally appropriate for a ${outputLanguage}-speaking audience.
  `;

  return { systemInstruction, taskPrompt, useMealSearch };
}

/**
 * Build the abstract content-generation request: provider-neutral parts plus
 * generation/system flags. Each driver maps `parts` and `useWebSearch` into
 * its own SDK shape.
 *
 * `searchContext`, when present, is a pre-formatted research dossier (see
 * tavily.js#formatSearchResultsForPrompt) that gets injected into the prompt
 * before the task brief. Pass it in when the driver pre-fetched search
 * results (Tavily flow); leave empty when the provider's own tool will handle
 * search (Gemini's googleSearch flow).
 *
 * @returns {{
 *   systemInstruction: string,
 *   parts: Array<{text:string} | {image:{mimeType:string,data:string}}>,
 *   generation: { temperature: number, topP: number, maxOutputTokens: number },
 *   useWebSearch: boolean,
 * }}
 */
export function buildContentRequest(params) {
  const {
    documentContext = "",
    documentImages = [],
    userInput,
    useRAG,
    searchContext = "",
  } = params;
  const { systemInstruction, taskPrompt, useMealSearch } = buildPrompts(params);

  const researchBlock = searchContext
    ? `\n--- BEGIN WEB RESEARCH DOSSIER ---\n${searchContext}\n--- END WEB RESEARCH DOSSIER ---\n\nUse the dossier above as your primary factual source for prices, hours, addresses, and any other current data. Treat the dossier as silent background knowledge: do NOT include any source URLs, Markdown links, bare URLs, domain names, or parenthetical attributions in the output — the reader must see clean prose only. Do NOT invent facts that are not in the dossier; if a fact is missing, state that the information is not currently available rather than guessing.\n\n`
    : "";

  const parts = [];
  if (documentImages.length > 0) {
    const contextInstruction = `**IMPORTANT CONTEXT:** You MUST use the following document images as the primary source of truth for your response. Find the relevant information about "${userInput}" within the document and use it to generate the content.\n\n`;
    parts.push({ text: researchBlock + contextInstruction + taskPrompt });
    for (const dataUrl of documentImages) {
      const parsed = parseDataUrl(dataUrl);
      if (parsed) parts.push({ image: { mimeType: parsed.mimeType, data: parsed.data } });
    }
  } else if (documentContext) {
    const contextBlock = `
**IMPORTANT CONTEXT:** You MUST use the following information from a user-provided document as the primary source of truth for your response. Paraphrase, restructure, and enhance this content into a compelling story for the customer about "${userInput}". Do NOT simply copy the text.
--- START OF DOCUMENT ---
${documentContext}
--- END OF DOCUMENT ---
`;
    parts.push({ text: researchBlock + contextBlock + taskPrompt });
  } else {
    parts.push({ text: researchBlock + taskPrompt });
  }

  return {
    systemInstruction,
    parts,
    generation: { temperature: 0.7, topP: 0.95, maxOutputTokens: 8192 },
    useWebSearch: Boolean(useRAG || useMealSearch),
  };
}

/* ------------------------------------------------------------------ */
/*  Entity extraction — shared prompt + JSON schema                    */
/* ------------------------------------------------------------------ */

export function buildEntityExtractionPrompt(inputLanguage) {
  return `You are an expert travel document analyst. Your task is to meticulously analyze the following document, which is written in ${inputLanguage}. Extract all names of cities, tourist attractions, and specific food dishes or meals.

**CRITICAL INSTRUCTION FOR ITINERARIES:**
If the document describes a day-by-day itinerary (e.g., using terms like "Day 1", "Day 2", "第一天", "第二天", "2024-01-01"), you MUST identify which day or date each entity belongs to.

For each entity found, you must provide:
1.  \`name\`: The name of the entity exactly as it appears.
2.  \`type\`: Classify it as "City", "Attraction", or "Meal".
3.  \`day\`: (Optional) The day or date associated with this entity in the itinerary (e.g., "Day 1", "第一天"). If the document is not an itinerary or the entity is mentioned generally, leave this empty.
4.  \`disambiguationQuery\`: Create a highly specific and context-aware Google Search query that would uniquely identify this entity.
    - For attractions, include the city, region, or country they are located in, and any specific context from the document (e.g., "Kiyomizu-dera temple Kyoto Japan" instead of just "Kiyomizu-dera").
    - For meals, include the cuisine type, the city/region they are famous in, or specific ingredients mentioned (e.g., "Khao Soi curry noodle soup Chiang Mai Thailand" instead of just "Khao Soi").
    - If the document mentions a specific restaurant or location for a meal, include that in the query.

Return your findings as a JSON array of objects. If no entities are found, return an empty array.`;
}
