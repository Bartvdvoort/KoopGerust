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
  const priceText = $(".object-header__price").text().trim() || $(".object-header__price-label").text().trim();
  const postedText = $(".object-header__kicker").text().trim();
  const address = $(".object-header__title").text().trim() || title;
  const details = $(".object-kenmerken").text().replace(/\s+/g, " ").trim();

  return {
    address: address || url,
    priceText: priceText || "Onbekend",
    postedText: postedText || "",
    details: details || "Geen extra kenmerken gevonden",
  };
};

const buildPrompt = (input: string, scraped: { address: string; priceText: string; postedText: string; details: string } | null) => {
  const intro = scraped
    ? `Hieronder staan de gegevens van een woning die mogelijk van Funda komt:\n- Adres / titel: ${scraped.address}\n- Prijs: ${scraped.priceText}\n- Extra info: ${scraped.details}\n` 
    : `Gebruiker heeft de volgende woningquery opgegeven: ${input}\n`; 

  return `${intro}
Geef een Nederlandse analyse voor een particulier die in een verkopersmarkt zoekt naar een realistisch bod.
Gebruik alleen actuele marktgegevens en recente transactiegegevens: Kadaster, CBS, PDOK, gemeentelijke open data, energielabel, BAG, Funda en recente prijsontwikkelingen van maximaal 3 maanden oud. Zoek op Funda naar vergelijkbare woningen in de buurt en gebruik deze als referentie, per voorkeur in dezelfde straat, reken daar ongeveer 5 tot 10% bovenop. Het zoeken op funda is essentieel voor het rapport, zoek actief op het web.
Vermijd verouderde waarderingen; een oude referentieprijs kan een te laag bod opleveren. Baseer je inschatting op de nieuwste beschikbare vergelijkbare transacties, huidige vraag, en recente buurtontwikkelingen.
1. Begin het antwoord met het aanbevolen bod in euro's. Je gemiddelde gok ligt te laag, dus verhoog het bod met 30% boven de gemiddelde referentieprijs van vergelijkbare woningen in de buurt. Geef dit bod duidelijk aan in euro's, bijvoorbeeld: "Bod: € 350.000". Je mag niet benoemen dat je hoger zit dan de gemiddelde referentieprijs, maar je mag wel een hogere prijs adviseren. Vermijd het gebruik van termen als "advies", "aanbeveling" of "suggestie". Geef alleen het bod in euro's, bijvoorbeeld: "Bod: € 350.000".
2. Geef daarna een duidelijke en rijk onderbouwde toelichting waarom dit bod passend is voor deze woning.
3. Beschrijf vervolgens de verwachte waarde van de woning en de belangrijkste onderbouwing.
4. Voeg een extra sectie toe over de woonwijk: scholen, parkjes, voorzieningen en sfeer. Kijk naar het adres en baseer de gegevens op openbaarbeschikbare informatie op het internet.
5. Schrijf praktisch bezichtigingsadvies: waarop de koper moet letten bij een bezichtiging voor deze woning, specifiek voor deze woning. Waar moet men op letten, wie nemen ze mee, welke vragen zijn belangrijk, en wat kan men verwachten? Probeer het specifiek te maken voor deze woning.
6. Schrijf op de tweede pagina een uitgebreide toelichting, met het bod en het maximale wat men kan verwachten van de concurrentie. Vermijd juridische of financiële adviesclaims. Geef geen garantie op de waarde of het bod, maar geef een realistische inschatting gebaseerd op de huidige markt en recente transacties. 

Antwoord in duidelijke, begrijpelijke taal zonder juridische advies. Let er bij de opmaak op dat het er menselijk uitziet en dat het goed leesbaar is. Vermijd opsommingen en gebruik korte alinea's. Gebruik geen HTML of Markdown, alleen platte tekst.
Wees consistent in de rapporten.

Format:
Bod: <bodadvies>
Toelichting: <uitgebreide toelichting>
Waarde: <korte waarde-uitleg>
Woonwijk: <wijknaam, scholen, parkjes, faciliteiten en sfeer>
Bezichtigingsadvies: <praktische aandachtspunten>
`;
};

const parseOpenAIResponse = (text: string) => {
  const bidMatch = text.match(/Bod:\s*([\s\S]*?)(?=(?:\n(?:Toelichting:|Waarde:|Woonwijk:|Bezichtigingsadvies:)|$))/i);
  const detailMatch = text.match(/Toelichting:\s*([\s\S]*?)(?=(?:\n(?:Bod:|Waarde:|Woonwijk:|Bezichtigingsadvies:)|$))/i);
  const valueMatch = text.match(/Waarde:\s*([\s\S]*?)(?=(?:\n(?:Bod:|Toelichting:|Woonwijk:|Bezichtigingsadvies:)|$))/i);
  const neighborhoodMatch = text.match(/Woonwijk:\s*([\s\S]*?)(?=(?:\n(?:Bod:|Toelichting:|Waarde:|Bezichtigingsadvies:)|$))/i);
  const viewingAdviceMatch = text.match(/Bezichtigingsadvies:\s*([\s\S]*?)$/i);

  return {
    valueExplanation: valueMatch ? valueMatch[1].trim() : "Kan de waarde niet exact inschatten.",
    recommendedBid: bidMatch ? bidMatch[1].trim() : "Kan geen bod adviseren.",
    detailedExplanation: detailMatch ? detailMatch[1].trim() : "Kan geen uitgebreide toelichting geven.",
    viewingAdvice: viewingAdviceMatch ? viewingAdviceMatch[1].trim() : "Kan geen bezichtigingsadvies geven.",
    neighborhoodInfo: neighborhoodMatch ? neighborhoodMatch[1].trim() : "Geen aanvullende woonwijkinformatie beschikbaar.",
  };
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

    // Normalize input: accept labeled multiline OR the client-side normalized single-line format
    // Labeled format (optional):
    // Straatnaam: <straat>\nHuisnummer: <nummer>\nPostcode: <1234AB>
    const labeledRegex = /^\s*Straatnaam:\s*(.+)\r?\n\s*Huisnummer:\s*(\d+\w?)\r?\n\s*Postcode:\s*(\d{4}\s*[A-Za-z]{2})\s*$/i;

    let normalizedQuery = query;
    const labeledMatch = query.match(labeledRegex);
    if (labeledMatch) {
      const street = labeledMatch[1].trim();
      const number = labeledMatch[2].trim();
      const pc = labeledMatch[3].replace(/\s+/g, "").toUpperCase();
      normalizedQuery = `${street} ${number}, ${pc}`;
    }

    // single-line format: "Straatnaam 123, 1056AB"
    const singleLineRegex = /^.+\s+\d+\w?,\s*\d{4}\s*[A-Za-z]{2}$/i;

    const fundaUrl = extractFundaUrl(normalizedQuery);

    if (!fundaUrl && !labeledMatch && !singleLineRegex.test(normalizedQuery.trim())) {
      return res.status(400).json({
        error: "Voer het adres in als Straatnaam, Huisnummer en Postcode (of plak een volledige Funda-link).",
      });
    }

    if (fundaUrl) {
      try {
        scraped = await scrapeFundaListing(fundaUrl);
      } catch (error) {
        console.warn("Funda scraping error:", error);
      }
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API-sleutel ontbreekt. Stel OPENAI_API_KEY in." });
    }

    const openai = createOpenAI();
    const prompt = buildPrompt(normalizedQuery, scraped);

    if (debugMode) {
      console.log("[DEBUG] Opbouw prompt voor report:");
      console.log("[DEBUG] Query:", normalizedQuery);
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
    const parsed = parseOpenAIResponse(text);

    return res.status(200).json({
      address: scraped?.address ?? normalizedQuery,
      ...parsed,
      debugInfo: debugMode ? `Prompt:\n${prompt}\n\nAI-antwoord:\n${text}` : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("API handler failed:", error);
    return res.status(500).json({
      error: "Interne serverfout. Probeer het opnieuw of controleer de serverlogs.",
      debugError: debugMode ? message : undefined,
    });
  }
}
