import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import * as cheerio from "cheerio";

export const config = {
  api: {
    responseLimit: "4mb",
  },
};

const createOpenAI = () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};

const debugMode = process.env.DEBUG_PROMPT === "true";
const runtimeFetch = typeof globalThis.fetch === "function" ? globalThis.fetch : fetch;

type Data = {
  address: string;
  valueExplanation: string;
  recommendedBid: string;
  listingPriceRaw?: string;
  listingPriceNumber?: number;
  listingPriceDetected?: boolean;
  conservativeBid?: string;
  averageBid?: string;
  highBid?: string;
  acceptanceEstimates?: Record<string, string>;
  fullText?: string;
  wasClamped?: boolean;
  originalBids?: Record<string, any>;
  detailedExplanation: string;
  viewingAdvice: string;
  neighborhoodInfo: string;
  debugInfo?: string;
};

type ErrorData = {
  error: string;
  debugError?: string;
};

const extractFundaUrl = (query: string) => {
  const fundaRegex = /(https?:\/\/)?(www\.)?funda\.nl\/[^\s]+/i;
  const match = query.match(fundaRegex);
  return match ? match[0] : null;
};

const scrapeFundaListing = async (url: string) => {
  const response = await runtimeFetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Funda-pagina kon niet worden opgehaald (status ${response.status})`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim();
  let priceText = $(".object-header__price").text().trim() || $(".object-header__price-label").text().trim();
  const postedText = $(".object-header__kicker").text().trim();
  const address = $(".object-header__title").text().trim() || title;
  // Try to extract feature list (woonoppervlakte, kamers, bouwjaar, energielabel)
  const featuresText = $(".object-kenmerken, .object-kenmerken__list").text().replace(/\s+/g, " ").trim();

  // Heuristics: search for numbers followed by m2, kamers, bouwjaar, etc.
  let livingArea: string | undefined = undefined;
  let rooms: string | undefined = undefined;
  let yearBuilt: string | undefined = undefined;

  // Primary heuristics from the featuresText
  const livingAreaMatch = featuresText.match(/(woonoppervlakte|woonopp|woonopp\.|oppervlakte woning)[:\s]*([0-9]{1,4})/i) || featuresText.match(/([0-9]{1,4})\s*m\b/i);
  const roomsMatch = featuresText.match(/(kamers|slaapkamers|aantal kamers)[:\s]*([0-9]{1,2})/i);
  const yearMatch = featuresText.match(/(bouwjaar|jaar)[:\s]*([0-9]{4})/i) || featuresText.match(/gebouwd\s+in\s+([0-9]{4})/i);

  if (livingAreaMatch) livingArea = livingAreaMatch[2];
  if (roomsMatch) rooms = roomsMatch[2];
  if (yearMatch) yearBuilt = yearMatch[2];

  // Try JSON-LD embedded structured data (often present on listing pages)
  try {
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const jsonText = $(el).contents().text();
        if (!jsonText) return;
        const obj = JSON.parse(jsonText);
        const items = Array.isArray(obj) ? obj : [obj];
        for (const it of items) {
          if (!it) continue;
          // floor size
          const floor = (it.floorSize && (it.floorSize.value || it.floorSize)) || it.floorSize;
          if (!livingArea && floor) {
            const f = typeof floor === 'object' ? (floor.value || floor['@value']) : floor;
            const num = String(f).match(/([0-9]{1,4})/);
            if (num) livingArea = num[1];
          }
          // number of rooms
          const roomsVal = it.numberOfRooms || it.numberOfRoomsTotal || it.roomCount;
          if (!rooms && roomsVal) {
            const rn = String(roomsVal).match(/([0-9]{1,2})/);
            if (rn) rooms = rn[1];
          }
          // year built
          const yearVal = it.yearBuilt || it.dateBuilt || it.contractDate;
          if (!yearBuilt && yearVal) {
            const yn = String(yearVal).match(/(19|20)\d{2}/);
            if (yn) yearBuilt = yn[0];
          }
        }
      } catch (e) {
        // ignore JSON parse errors
      }
    });
  } catch (e) {
    // ignore
  }

  // Fallback: search the raw HTML for other common labels/patterns
  if (!livingArea) {
    const htmlAreaMatch = html.match(/(woonoppervlakte|oppervlakte woning|woonoppervlakte[:\s]*)[^0-9]{0,6}([0-9]{1,4})\s*m/i) || html.match(/([0-9]{1,4})\s*m2/i);
    if (htmlAreaMatch) livingArea = htmlAreaMatch[2] || htmlAreaMatch[1];
  }

  if (!rooms) {
    const htmlRoomsMatch = html.match(/(aantal kamers|kamers|slaapkamers)[:\s]*([0-9]{1,2})/i) || html.match(/([0-9]{1,2})\s*kamer/i);
    if (htmlRoomsMatch) rooms = htmlRoomsMatch[2] || htmlRoomsMatch[1];
  }

  if (!yearBuilt) {
    const htmlYearMatch = html.match(/(bouwjaar|jaar)[:\s]*([0-9]{4})/i) || html.match(/gebouwd\s+in\s+([0-9]{4})/i);
    if (htmlYearMatch) yearBuilt = htmlYearMatch[2] || htmlYearMatch[1];
  }

  // Listing id from URL
  const listingIdMatch = url.match(/\/([0-9]+)\/$/) || url.match(/-([0-9]+)\//);
  const listingId = listingIdMatch ? listingIdMatch[1] : undefined;

  // Fallback: try to find a currency-like string in the raw HTML if selector lookup failed
  if (!priceText) {
    const htmlPriceMatch = html.match(/€\s?[0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?/);
    if (htmlPriceMatch) {
      priceText = htmlPriceMatch[0];
    }
  }

  return {
    address: address || url,
    priceText: priceText || "Onbekend",
    postedText: postedText || "",
    details: featuresText || "Geen extra kenmerken gevonden",
    livingArea,
    rooms,
    yearBuilt,
    listingId,
    url,
  } as any;
};

const buildPrompt = (input: string, scraped: any | null) => {
  const listingPrice = scraped?.priceText || "Onbekend";
  const intro = scraped
    ? `Gegeven de volgende Funda-woninggegevens:\n- Adres / titel: ${scraped.address}\n- Vraagprijs: ${scraped.priceText}\n- Kenmerken: ${scraped.details}\n- Woonoppervlakte: ${scraped.livingArea || "onbekend"}\n- Kamers: ${scraped.rooms || "onbekend"}\n- Bouwjaar: ${scraped.yearBuilt || "onbekend"}\n` 
    : `Gebruiker heeft de volgende woningquery opgegeven: ${input}\n`;

  return `${intro}
Je bent een ervaren Nederlandse woninganalist. Schrijf een helder, praktisch en goed onderbouwd rapport voor een particuliere koper in een verkopersmarkt.

Belangrijke instructies (Nederlands):
- Controleer de vraagprijs (vraagprijs zoals opgegeven op Funda: ${listingPrice}). Je MAG NOOIT een bod adviseren dat lager is dan de vraagprijs die op Funda staat. Als je normaal gesproken een lager 'voorzichtig' bod zou geven, gebruik dan in plaats daarvan minimaal de vraagprijs.
- Geef vier biedingen: conservativeBid, averageBid, highBid en adviceBid. Voor elk bod geef je ook een korte inschatting in procenten of een korte zin van de kans dat dat bod geaccepteerd wordt (bijv. "40% kans" of "laag/matig/hoog").
- Geef daarnaast een korte valueExplanation, neighborhoodInfo en viewingAdvice.
- Tot slot: lever het volledige, onbewerkte antwoord mee als fullText zodat het in het PDF opgenomen kan worden.

Outputvereiste:
Antwoord uitsluitend met één enkele JSON-object (zonder extra tekst) met de volgende keys: "conservativeBid", "averageBid", "highBid", "adviceBid", "acceptanceEstimates", "valueExplanation", "neighborhoodInfo", "viewingAdvice", "fullText".

Formatvoorbeeld (moet exact parsebaar JSON zijn):
{
  "conservativeBid": "€ 350.000",
  "averageBid": "€ 365.000",
  "highBid": "€ 385.000",
  "adviceBid": "€ 365.000",
  "acceptanceEstimates": { "conservativeBid": "70%", "averageBid": "50%", "highBid": "30%", "adviceBid": "50%" },
  "valueExplanation": "Korte uitleg over waarde en vergelijking...",
  "neighborhoodInfo": "Wijk, scholen, voorzieningen...",
  "viewingAdvice": "Praktische tips voor bezichtiging...",
  "fullText": "Hier komt het volledige onbewerkte rapport met alle toelichting."
}

Belangrijk: Als je bij sommige velden onzeker bent, geef dan eerlijk een korte tekst met de reden. Gebruik altijd euro-formattering met symbool € en punten als duizendtalscheiding waar passend. Gebruik alleen platte tekst in de values (geen HTML of Markdown). Zorg dat alle biedingen minimaal gelijk zijn aan de vermeldde vraagprijs (indien beschikbaar).

Schrijf het antwoord in het Nederlands.
`;
};

const parseOpenAIResponse = (text: string, scraped: any | null) => {
  // Attempt to find a JSON object in the model output (non-greedy)
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  let parsedJson: any = null;

  if (jsonMatch) {
    try {
      parsedJson = JSON.parse(jsonMatch[0]);
    } catch (e) {
      // ignore parse error and fall back
      parsedJson = null;
    }
  }

  const ensureCurrency = (v: any) => {
    if (!v) return undefined;
    if (typeof v === "number") return `€ ${v.toLocaleString("nl-NL")}`;
    if (typeof v === "string") {
      const parsed = parseFallbackNumber(v);
      if (parsed) return `€ ${parsed.toLocaleString("nl-NL")}`;
      return v.trim();
    }
    return String(v);
  };

  const parseFallbackNumber = (priceText: string | undefined) => {
    if (!priceText) return undefined;
    const digits = priceText.replace(/[^.0-9,]/g, "").replace(/\./g, "").replace(/,/g, "");
    const num = parseInt(digits || "", 10);
    return Number.isFinite(num) ? num : undefined;
  };

  const listingPriceNum = parseFallbackNumber(scraped?.priceText);

  if (parsedJson) {
    // Ensure bids are not below listing price (if known)
    const clampBid = (s: any) => {
      if (!s) return s;
      const num = parseFallbackNumber(String(s));
      if (listingPriceNum && num && num < listingPriceNum) {
        // replace with listing price formatted
        return `€ ${listingPriceNum.toLocaleString("nl-NL")}`;
      }
      return ensureCurrency(s);
    };

    const conservativeBid = clampBid(parsedJson.conservativeBid);
    const averageBid = clampBid(parsedJson.averageBid);
    const highBid = clampBid(parsedJson.highBid);
    const adviceBid = clampBid(parsedJson.adviceBid) || averageBid || conservativeBid || highBid;

    return {
      valueExplanation: parsedJson.valueExplanation || parsedJson.waarde || "Kan de waarde niet exact inschatten.",
      recommendedBid: adviceBid || "Geen concreet adviesbod beschikbaar.",
      conservativeBid,
      averageBid,
      highBid,
      acceptanceEstimates: parsedJson.acceptanceEstimates || parsedJson.acceptanceEstimates || undefined,
      detailedExplanation: parsedJson.valueExplanation || parsedJson.toelichting || (parsedJson.fullText ? parsedJson.fullText.substring(0, 800) : "Geen uitgebreide toelichting beschikbaar."),
      viewingAdvice: parsedJson.viewingAdvice || parsedJson.bezichtigingsadvies || "Geen bezichtigingsadvies beschikbaar.",
      neighborhoodInfo: parsedJson.neighborhoodInfo || parsedJson.woonwijk || "Geen aanvullende woonwijkinformatie beschikbaar.",
      fullText: parsedJson.fullText || text,
    };
  }

  // Fallback parsing when model didn't output JSON
  const bidMatch = text.match(/Bod:\s*([\s\S]*?)(?=(?:\n(?:Toelichting:|Waarde:|Woonwijk:|Bezichtigingsadvies:)|$))/i);
  const detailMatch = text.match(/Toelichting:\s*([\s\S]*?)(?=(?:\n(?:Bod:|Waarde:|Woonwijk:|Bezichtigingsadvies:)|$))/i);
  const valueMatch = text.match(/Waarde:\s*([\s\S]*?)(?=(?:\n(?:Bod:|Toelichting:|Woonwijk:|Bezichtigingsadvies:)|$))/i);
  const neighborhoodMatch = text.match(/Woonwijk:\s*([\s\S]*?)(?=(?:\n(?:Bod:|Toelichting:|Waarde:|Bezichtigingsadvies:)|$))/i);
  const viewingAdviceMatch = text.match(/Bezichtigingsadvies:\s*([\s\S]*?)$/i);

  // Derive simple bids based on listing price when possible
  const listing = listingPriceNum || 0;
  const cons = listing ? `€ ${Math.round(listing * 1).toLocaleString("nl-NL")}` : undefined;
  const avg = listing ? `€ ${Math.round(listing * 1.03).toLocaleString("nl-NL")}` : undefined;
  const high = listing ? `€ ${Math.round(listing * 1.08).toLocaleString("nl-NL")}` : undefined;

  return {
    valueExplanation: valueMatch ? valueMatch[1].trim() : "Kan de waarde niet exact inschatten.",
    recommendedBid: avg || (bidMatch ? bidMatch[1].trim() : "Geen concreet bod beschikbaar."),
    conservativeBid: cons,
    averageBid: avg,
    highBid: high,
    acceptanceEstimates: { conservativeBid: "onbekend", averageBid: "onbekend", highBid: "onbekend" },
    detailedExplanation: detailMatch ? detailMatch[1].trim() : (text.substring(0, 800) || "Geen uitgebreide toelichting beschikbaar."),
    viewingAdvice: viewingAdviceMatch ? viewingAdviceMatch[1].trim() : "Geen bezichtigingsadvies beschikbaar.",
    neighborhoodInfo: neighborhoodMatch ? neighborhoodMatch[1].trim() : "Geen aanvullende woonwijkinformatie beschikbaar.",
    fullText: text,
  };
};

const sanitizeAiText = (txt?: string) => {
  if (!txt) return txt || "";
  let t = String(txt || "");
  // Remove raw JSON-like fragments, braces and brackets to avoid leaking internal keys
  t = t.replace(/\{+|\}+|\[+|\]+/g, " ");
  // Remove quoted number lists like "500","000","000"
  t = t.replace(/"\s*\d{1,3}\s*"(?:\s*,\s*"\s*\d{1,3}\s*")+/g, " ");
  // Remove common JSON key patterns (e.g. "valueExplanation":) to avoid merged keys in text
  t = t.replace(/"?[A-Za-z0-9_]+"?\s*:\s*/g, " ");
  // Remove acceptance header lines (e.g. 'Kans op acceptatie (indicatie)')
  // Remove acceptance header blocks (including following lines listing percentages)
  t = t.replace(/Kans op acceptatie[^\n]*[\s\S]*?(?:\n\s*\n|$)/gim, "");
  // Remove lines that list internal keys like conservativeBid: 80%
  t = t.replace(/^\s*(conservativeBid|averageBid|highBid|adviceBid|advice)\s*[:=\-].*$/gim, "");
  // Remove lines that show percentages for common Dutch labels
  t = t.replace(/^\s*(voorzichtig|gemiddeld|hoog|adviesbod)\s*[:=\-]\s*\d+%.*$/gim, "");
  // Remove lines that show keys followed by percentage (generic)
  t = t.replace(/^\s*\w+\s*[:=\-]\s*\d+%.*$/gim, "");
  // Remove sentences that reference acceptance chances or internal keys (also handles inline sentences)
  const sentences = t.match(/[^.?!\n]+[.?!\n]*/g) || [t];
  const filtered = sentences.filter((s) => {
    return !/(kans[^.?!\n]*acceptat|acceptat[^.?!\n]*kans|conservativeBid|averageBid|highBid|adviceBid|adviesbod|kans op acceptatie)/i.test(s);
  });
  t = filtered.join(" ");
  // Remove lines that start with 'Kenmerken' and generic percentage lines
  t = t.replace(/^\s*Kenmerken[:\s\-].*$/gim, "");
  t = t.replace(/^\s*\w+\s*[:=\-]\s*\d+%.*$/gim, "");
  // Remove stray quoted numbers like "439.500" -> 439.500
  t = t.replace(/"\s*([0-9]+[.,]?[0-9]*)\s*"/g, "$1");
  // Normalize spaces inside numbers like '€ 439. 500' -> '€ 439.500'
  t = t.replace(/(\d)\s+([.,])/g, "$1$2");
  t = t.replace(/([.,])\s+(\d)/g, "$1$2");
  // Collapse multiple spaces and normalize empty lines
  t = t.replace(/[ \t\u00A0]{2,}/g, " ");
  t = t.replace(/\n{2,}/g, "\n\n");
  // Trim each line and the whole text
  t = t.split('\n').map(l => l.trim()).join('\n');
  return t.trim();
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<Data | ErrorData>) {
  if (req.method === "GET") {
    return res.status(200).json({ error: "GET is niet toegestaan op deze endpoint. Gebruik POST met een JSON body." });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Alleen POST is toegestaan." });
  }

  try {
    const { query } = req.body as { query?: string };

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Voer een geldig adres of Funda-link in." });
    }

    let scraped = null;

    // Enforce Funda-only input: the API requires a full Funda listing URL.
    const fundaUrl = extractFundaUrl(query);

    if (!fundaUrl) {
      return res.status(400).json({ error: 'Voer een volledige Funda-link in. Andere invoer wordt niet ondersteund.' });
    }

    try {
      scraped = await scrapeFundaListing(fundaUrl);
    } catch (error) {
      console.warn("Funda scraping error:", error);
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API-sleutel ontbreekt. Stel OPENAI_API_KEY in." });
    }

    const openai = createOpenAI();
    const prompt = buildPrompt(fundaUrl, scraped);

    if (debugMode) {
      console.log("[DEBUG] Opbouw prompt voor report:");
      console.log("[DEBUG] Query:", fundaUrl);
      console.log("[DEBUG] Scraped data:", scraped);
      console.log("[DEBUG] Prompt:\n", prompt);
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Je bent een ervaren woninganalist die particuliere kopers helpt met betrouwbare, goed onderbouwde rapporten in het Nederlands. Schrijf professioneel en vermijd de term AI of vergelijkbare woorden. Richt je op vertrouwen en duidelijkheid. Hou goed rekening met de huidige woningmarkt en recente transacties, adviseer aan de hoge kant. Vermijd juridische of financiële adviesclaims.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 600,
      temperature: 0.8,
    });

    const text = completion.choices?.[0]?.message?.content ?? "";
    const parsed = parseOpenAIResponse(text, scraped);

      // Ensure bids are not below listing price (final safety clamp)
      const parseCurrencyToNumber = (s: any) => {
        if (!s) return undefined;
        if (typeof s === "number") return s;
        const str = String(s);
        const digits = str.replace(/[^0-9.,]/g, "").replace(/\./g, "").replace(/,/g, "");
        const num = parseInt(digits || "", 10);
        return Number.isFinite(num) ? num : undefined;
      };

      const formatCurrency = (n: number | undefined) => {
        if (!n && n !== 0) return undefined;
        return `€ ${n.toLocaleString("nl-NL")}`;
      };

      const listingPriceNum = parseCurrencyToNumber(scraped?.priceText);

      const clampToListing = (value: any) => {
        const num = parseCurrencyToNumber(value);
        if (listingPriceNum && num && num < listingPriceNum) return formatCurrency(listingPriceNum);
        if (num) return formatCurrency(num);
        // If value is a string without numbers, just return as-is
        return value;
      };

      const isPercentageLike = (v: any) => {
        if (!v || typeof v !== "string") return false;
        if (/%/.test(v)) return true;
        if (/\b(kans|chance|accept|kansrijk)\b/i.test(v)) return true;
        return false;
      };

      // Move accidental percentage values from bid fields into acceptanceEstimates
      const originalBids: Record<string, any> = {};
      const acceptance: Record<string, string> = parsed.acceptanceEstimates ? { ...parsed.acceptanceEstimates } : {};
      // sanitize acceptance values
      Object.keys(acceptance).forEach(k => {
        if (acceptance[k]) acceptance[k] = sanitizeAiText(String(acceptance[k]));
      });

      const fields = ["conservativeBid", "averageBid", "highBid", "recommendedBid"] as const;
      fields.forEach((f) => {
        const raw = (parsed as any)[f];
        if (raw !== undefined && raw !== null) {
          originalBids[f] = raw;
          if (isPercentageLike(raw)) {
            // Treat as acceptance estimate
            acceptance[f] = String(raw).trim();
            (parsed as any)[f] = undefined;
          }
        }
      });

      // Prefer AI-provided bids. If AI doesn't provide numeric bids, fall back to derived values.
      let finalConservative: any;
      let finalAverage: any;
      let finalHigh: any;
      let finalAdvice: any;

      const parsedCon = (parsed as any).conservativeBid;
      const parsedAvg = (parsed as any).averageBid;
      const parsedHigh = (parsed as any).highBid;
      const parsedAdvice = (parsed as any).recommendedBid || (parsed as any).adviceBid;

      const parsedConNum = parseCurrencyToNumber(parsedCon);
      const parsedAvgNum = parseCurrencyToNumber(parsedAvg);
      const parsedHighNum = parseCurrencyToNumber(parsedHigh);
      const parsedAdviceNum = parseCurrencyToNumber(parsedAdvice);

      // If AI provided bids, use them (after formatting and clamping). Otherwise, derive from listing price as a fallback.
      if (parsedConNum) finalConservative = clampToListing(parsedConNum);
      if (parsedAvgNum) finalAverage = clampToListing(parsedAvgNum);
      if (parsedHighNum) finalHigh = clampToListing(parsedHighNum);
      if (parsedAdviceNum) finalAdvice = clampToListing(parsedAdviceNum);

      // Fallback derived values when listing price is available
      if (listingPriceNum) {
        const deriveCon = Math.round(listingPriceNum * 0.965); // ~ -3.5%
        const deriveAdvice = Math.round(listingPriceNum * 1.105); // ~ +10.5%
        const deriveHigh = Math.round(listingPriceNum * 1.18); // ~ +18%
        const deriveAvg = Math.round((deriveCon + deriveAdvice) / 2);

        if (!finalConservative) finalConservative = formatCurrency(deriveCon);
        if (!finalAverage) finalAverage = formatCurrency(deriveAvg);
        if (!finalHigh) finalHigh = formatCurrency(deriveHigh);
        if (!finalAdvice) finalAdvice = formatCurrency(deriveAdvice);
      } else {
        // no listing price: use parsed values if any, else leave undefined
        if (!finalConservative && parsedCon) finalConservative = clampToListing(parsedCon);
        if (!finalAverage && parsedAvg) finalAverage = clampToListing(parsedAvg);
        if (!finalHigh && parsedHigh) finalHigh = clampToListing(parsedHigh);
        if (!finalAdvice && parsedAdvice) finalAdvice = clampToListing(parsedAdvice);
      }

      // Ensure average sits between conservative and advice
      const toNumber = (v: any) => parseCurrencyToNumber(v) || undefined;
      const consN = toNumber(finalConservative);
      const advN = toNumber(finalAdvice);
      const avgN = toNumber(finalAverage);
      if (consN && advN) {
        const mid = Math.round((consN + advN) / 2);
        if (!avgN || avgN < Math.min(consN, advN) || avgN > Math.max(consN, advN)) {
          finalAverage = formatCurrency(mid);
        }
      }

      const wasClamped = Object.keys(originalBids).length > 0 ||
        [finalConservative, finalAverage, finalHigh, finalAdvice].some((v) => {
          // detect if we forced to listing price
          if (!v || !listingPriceNum) return false;
          const num = parseCurrencyToNumber(v);
          return !!(num && listingPriceNum && num >= listingPriceNum && originalBids && Object.values(originalBids).some(ob => {
            const on = parseCurrencyToNumber(ob);
            return on && on < listingPriceNum;
          }));
        });
      // Compute price per m2 when possible and build structured header
      const livingAreaRaw = scraped?.livingArea;
      const livingAreaNum = livingAreaRaw ? parseInt(String(livingAreaRaw).replace(/[^0-9]/g, ""), 10) : undefined;
      const pricePerM2Num = listingPriceNum && livingAreaNum ? Math.round(listingPriceNum / livingAreaNum) : undefined;
      const pricePerM2 = pricePerM2Num ? `€ ${pricePerM2Num.toLocaleString("nl-NL")}/m²` : undefined;

      // Clean and prefer formatted listing price
      const rawPriceText = String(scraped?.priceText ?? "Onbekend");
      const cleanedRawPrice = rawPriceText
        .replace(/(\d)\s+([.,])/g, "$1$2")
        .replace(/([.,])\s+(\d)/g, "$1$2")
        .replace(/\s{2,}/g, " ")
        .trim();
      const listingDisplay = listingPriceNum ? `€ ${listingPriceNum.toLocaleString("nl-NL")}` : cleanedRawPrice;

      const headerLines = [] as string[];
      headerLines.push(`Adres: ${scraped?.address ?? fundaUrl}`);
      headerLines.push(`Vraagprijs: ${listingDisplay}`);
      headerLines.push(`Prijs per m2: ${pricePerM2 ?? "Onbekend"}`);
      headerLines.push(`Woonoppervlakte: ${scraped?.livingArea ?? "Onbekend"}`);
      headerLines.push(`Kamers: ${scraped?.rooms ?? "Onbekend"}`);
      headerLines.push(`Bouwjaar: ${scraped?.yearBuilt ?? "Onbekend"}`);
      headerLines.push("");

      const combinedDetailed = `${headerLines.join("\n")}\n${sanitizeAiText(parsed.detailedExplanation)}`.trim();

      const result = {
        address: scraped?.address ?? fundaUrl,
        valueExplanation: sanitizeAiText(parsed.valueExplanation),
        recommendedBid: finalAdvice,
        listingPriceRaw: scraped?.priceText,
        listingPriceNumber: listingPriceNum,
        listingPriceDetected: !!listingPriceNum,
        conservativeBid: finalConservative,
        averageBid: finalAverage,
        highBid: finalHigh,
        acceptanceEstimates: acceptance,
        detailedExplanation: combinedDetailed,
        viewingAdvice: sanitizeAiText(parsed.viewingAdvice),
        neighborhoodInfo: sanitizeAiText(parsed.neighborhoodInfo),
        fullText: sanitizeAiText(parsed.fullText || text),
        pricePerM2: pricePerM2,
        wasClamped: wasClamped,
        originalBids: Object.keys(originalBids).length ? originalBids : undefined,
        debugInfo: debugMode ? `Prompt:\n${prompt}\n\nAI-antwoord:\n${text}` : undefined,
      };

      return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("API handler failed:", error);
    return res.status(500).json({
      error: "Interne serverfout. Probeer het opnieuw of controleer de serverlogs.",
      debugError: debugMode ? message : undefined,
    });
  }
}
