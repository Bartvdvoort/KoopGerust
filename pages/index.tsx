import { useState, type FormEvent } from "react";
import jsPDF from "jspdf";

type Report = {
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

export default function Home() {
  const [fundaLink, setFundaLink] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloadMessage, setDownloadMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"advies" | "watKrijgIk" | "overOns" | "contact">("advies");
  const [showDebug, setShowDebug] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setReport(null);
    setLoading(true);

    const fundaRegex = /(https?:\/\/)?(www\.)?funda\.nl\/[^\s]+/i;

    if (!fundaLink.trim()) {
      setError("Plak een volledige Funda-link.");
      setLoading(false);
      return;
    }

    if (!fundaRegex.test(fundaLink.trim())) {
      setError("Ongeldige Funda-link. Gebruik een volledige URL van funda.nl.");
      setLoading(false);
      return;
    }

    const queryToSend = fundaLink.trim();

    try {
      setDownloadMessage("");
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: queryToSend }),
      });

      const text = await response.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Ongeldig antwoord van de server (status ${response.status}): ${text.slice(0, 200)}`);
      }

      if (!response.ok) {
        const message = data.error || `Er is iets misgegaan bij het ophalen van het rapport (status ${response.status}).`;
        const debugError = data.debugError ? `\nDebug: ${data.debugError}` : "";
        throw new Error(message + debugError);
      }

      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  };

  const sanitizeFilename = (value: string) => {
    const match = value.match(/(.+?)\s+(\d+\w?)/);
    const namePart = match ? `${match[1]}_${match[2]}` : value;
    return namePart
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .substring(0, 100);
  };

  const handleDownloadPdf = () => {
    if (!report) return;

    const fileBase = sanitizeFilename(report.address || "huisrapport");
    const fileName = `${fileBase || "huisrapport"}.pdf`;

    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const margin = 16;
    const pageWidth = 210;
    const maxWidth = pageWidth - margin * 2;
    let y = 20;

    // Header band with brand
    doc.setFillColor(29, 78, 216); // #1d4ed8
    doc.rect(0, 0, pageWidth, 32, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Gerustkopen.nl", margin, 12);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(report.address || "Onbekend adres", margin, 20);

    y = 40;

    // Helper to avoid showing qualitative values
    const hasDigits = (v: any) => /\d/.test(String(v || ""));
    const displayBid = (v: any) => (hasDigits(v) ? String(v) : "-");

    // Sanitize AI text to strip internal debug/acceptance lines and sentences
    const sanitizeAiText = (txt: any) => {
      if (!txt) return "";
      let t = String(txt);
      // Remove acceptance header blocks (including following lines listing percentages)
      t = t.replace(/Kans op acceptatie[^\n]*[\s\S]*?(?:\n\s*\n|$)/gim, "");
      // Remove any lines that list internal keys like conservativeBid: 80%
      t = t.replace(/^\s*(conservativeBid|averageBid|highBid|adviceBid|advice)\s*[:=\-].*$/gim, "");
      // Remove lines that show percentages for common Dutch labels
      t = t.replace(/^\s*(voorzichtig|gemiddeld|hoog|adviesbod)\s*[:=\-]\s*\d+%.*$/gim, "");
      // Remove generic key: 80% lines
      t = t.replace(/^\s*\w+\s*[:=\-]\s*\d+%.*$/gim, "");
      // Split into sentences and filter out sentences mentioning acceptance chances or internal keys
      const sentences = t.match(/[^.?!\n]+[.?!\n]*/g) || [t];
      const filtered = sentences.filter((s) => {
        return !/(kans[^.?!\n]*acceptat|acceptat[^.?!\n]*kans|conservativeBid|averageBid|highBid|adviceBid|adviesbod|kans op acceptatie)/i.test(s);
      });
      t = filtered.join(" ");
      return t.trim();
    };

    // Prominent advice box
    doc.setFillColor(239, 246, 255); // soft blue background
    // try roundedRect, fallback if not available
    if ((doc as any).roundedRect) {
      (doc as any).roundedRect(margin, y, maxWidth, 44, 6, 6, 'F');
      doc.setDrawColor(29, 78, 216);
      doc.setLineWidth(0.6);
      (doc as any).roundedRect(margin, y, maxWidth, 44, 6, 6, 'S');
    } else {
      doc.rect(margin, y, maxWidth, 44, 'F');
    }

    doc.setTextColor(13, 37, 85);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Ons adviesbod", margin + 6, y + 12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(29, 78, 216);
    doc.setFontSize(20);
    doc.text(displayBid(report.recommendedBid), margin + 6, y + 32);

    // Bids table
    y += 56;
    const bidRows = [
      { label: "Voorzichtig", value: report.conservativeBid },
      { label: "Gemiddeld", value: report.averageBid },
      { label: "Hoog", value: report.highBid },
    ];

    bidRows.forEach((r) => {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(13, 37, 85);
      doc.setFontSize(11);
      doc.text(`${r.label}:`, margin, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(29, 78, 216);
      const valueText = displayBid(r.value);
      const valueWidth = doc.getTextWidth(valueText);
      doc.text(valueText, margin + maxWidth - valueWidth, y);
      y += 8;
    });
    // Acceptance estimates: only show numeric/percent values
    const acceptanceEntries = Object.entries(report.acceptanceEstimates || {}).filter(([, v]) => /\d/.test(String(v || "")));
    if (acceptanceEntries.length > 0) {
      y += 4;
      doc.setFont("helvetica", "bold");
      doc.setTextColor(13, 37, 85);
      doc.setFontSize(11);
      doc.text("Kans op acceptatie (indicatie)", margin, y);
      y += 8;
      acceptanceEntries.forEach(([k, v]) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(69, 85, 105);
        doc.text(`${k}: ${String(v)}`, margin + 6, y);
        y += 7;
      });
    }

    y += 6;

    // Toelichting
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(13, 37, 85);
    doc.text("Toelichting", margin, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(69, 85, 105);
    const sanitizedDetail = sanitizeAiText(report.detailedExplanation || report.valueExplanation || "-");
    const detailLines = doc.splitTextToSize(sanitizedDetail, maxWidth);
    doc.text(detailLines, margin, y);
    y += detailLines.length * 6 + 6;

    // Woonwijk + Bezichtigingsadvies
    const smallSections = [
      { title: "Woonwijkinformatie", text: report.neighborhoodInfo },
      { title: "Bezichtigingsadvies", text: report.viewingAdvice },
    ];

    smallSections.forEach(({ title, text }) => {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(13, 37, 85);
      doc.text(title, margin, y);
      y += 8;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(69, 85, 105);
      const lines = doc.splitTextToSize(sanitizeAiText(text || "-"), maxWidth);
      doc.text(lines, margin, y);
      y += lines.length * 6 + 8;
    });

    // Footer
    doc.setTextColor(120, 129, 156);
    doc.setFontSize(10);
    doc.text("gerustkopen.nl — Heldere rapporten voor particulieren", margin, 290);

    // Second page: full AI text (fullText) or detailedExplanation
    doc.addPage();
    y = 20;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(13, 37, 85);
    doc.text("Uitgebreide toelichting", margin, y);
    y += 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const full = sanitizeAiText(report.fullText || report.detailedExplanation || "Geen aanvullende tekst beschikbaar.");
    const fullLines = doc.splitTextToSize(full, maxWidth);
    doc.text(fullLines, margin, y);

    doc.save(fileName);
    setDownloadMessage(`PDF ${fileName} is gedownload en wordt nu naar je downloads gestuurd.`);
  };

  return (
    <main className="container">
      <section className="hero">
        <div className="hero-copy">
          <p style={{ margin: 0, color: "#2563eb", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.16em" }}>
            Gerust kopen
          </p>
          <h1>Kan ik dit huis met een gerust hart kopen?</h1>
          <p>
            Ontvang een helder en onderbouwd rapport voor het huis waarin je geïnteresseerd bent. Het advies helpt je
            of het huis echt past bij jouw kansen, welke waarde je kunt verwachten en hoe je slim biedt zonder onnodig risico.
          </p>
          <p style={{ marginTop: "1rem", color: "#475569", fontSize: "0.98rem" }}>
            De analyse combineert fundamentele woningdata met betrouwbare markt- en omgevingsinformatie, zodat je een
            beter onderbouwde inschatting krijgt.
          </p>

          <div className="tabs" style={{ marginTop: "1.75rem" }}>
            <button className={`tab-button ${activeTab === "advies" ? "active" : ""}`} type="button" onClick={() => setActiveTab("advies")}>Advies</button>
            <button className={`tab-button ${activeTab === "watKrijgIk" ? "active" : ""}`} type="button" onClick={() => setActiveTab("watKrijgIk")}>Wat krijg ik</button>
            <button className={`tab-button ${activeTab === "overOns" ? "active" : ""}`} type="button" onClick={() => setActiveTab("overOns")}>Over ons</button>
            <button className={`tab-button ${activeTab === "contact" ? "active" : ""}`} type="button" onClick={() => setActiveTab("contact")}>Contact</button>
          </div>

          {activeTab === "advies" ? (
            <div className="feature-list">
              <div className="feature-card">
                <h3>Direct inzicht</h3>
                <p>Snelle analyse van het huis met een praktische samenvatting van waarde en biedstrategie.</p>
              </div>
              <div className="feature-card">
                <h3>Betrouwbaar advies</h3>
                <p>Een compacte, zakelijke rapportage die je helpt met zekerheid een betere inschatting te maken.</p>
              </div>
              <div className="feature-card">
                <h3>Open data onderbouwing</h3>
                <p>Onderbouwd met betrouwbare markt- en omgevingsgegevens die het advies extra context geven.</p>
              </div>
              <div className="feature-card">
                <h3>Heldere structuur</h3>
                <p>Duidelijke scheiding tussen waarde, bod en toelichting, zodat je direct de essentie begrijpt.</p>
              </div>
            </div>
          ) : activeTab === "watKrijgIk" ? (
            <div className="about-card" style={{ marginTop: "1.75rem" }}>
              <h2 style={{ marginTop: 0, fontSize: "1.75rem" }}>Wat krijg ik</h2>
              <h3 style={{ marginTop: "0.75rem", fontSize: "1.1rem", marginBottom: "0.5rem" }}>Wat krijg je voor je geld?</h3>
              <p style={{ color: "#475569", margin: "0 0 1rem" }}>
                Na je aanvraag ontvang je een persoonlijk PDF-rapport voor de woning die je op het oog hebt.
              </p>

              <ul style={{ color: "#475569", margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
                <li><strong>Aanbevolen bod</strong> — een concreet biedadvies op basis van beschikbare markt- en woningdata.</li>
                <li><strong>Waarom dit bod?</strong> — een heldere uitleg van de factoren die het advies bepalen.</li>
                <li><strong>Waarde-inschatting</strong> — een onderbouwde indicatie van de verwachte marktwaarde.</li>
                <li><strong>Woonwijk &amp; omgeving</strong> — relevante informatie over voorzieningen, bereikbaarheid en de omgeving.</li>
                <li><strong>Bezichtigingsadvies</strong> — praktische aandachtspunten om tijdens de bezichtiging te controleren.</li>
              </ul>

              <p style={{ color: "#475569", margin: 0 }}>
                <strong>Downloadbaar als PDF</strong> — bewaar het rapport, vergelijk woningen of deel het met je aankoopmakelaar of financieel adviseur.
              </p>
            </div>
          ) : activeTab === "overOns" ? (
            <div className="about-card" style={{ marginTop: "1.75rem" }}>
              <h2 style={{ marginTop: 0, fontSize: "1.75rem" }}>Onze missie</h2>
              <p style={{ color: "#475569", margin: "1rem 0 1.25rem" }}>
                Wij bestaan om kopers betere kansen te bieden op de huizenmarkt, zonder ze meteen op hoge kosten te jagen.
                Het kopen van een huis is een van de belangrijkste beslissingen in je leven, maar voor particulieren is er
                nog te weinig duidelijke informatie beschikbaar.
              </p>
              <p style={{ color: "#475569", margin: "0 0 1rem" }}>
                In een tijd waarin de markt snel beweegt en verkopers vaak de regie hebben, willen we helderheid en
                inzicht terugbrengen voor particulieren. Onze rapporten geven je de handvatten om een realistisch bod
                te bepalen en weloverwogen te beslissen.
              </p>
              <p style={{ color: "#475569", margin: 0 }}>
                We helpen kopers met de feiten die ze nodig hebben, zodat ze zelfverzekerd naar een huis kunnen bieden,
                zonder te veel te betalen en met betere kansen in een krappe markt.
              </p>
            </div>
          ) : (
            <div className="about-card" style={{ marginTop: "1.75rem" }}>
              <h2 style={{ marginTop: 0, fontSize: "1.75rem" }}>Contact</h2>
              <p style={{ color: "#475569", margin: "1rem 0 1.25rem" }}>
                Neem contact met ons op voor vragen over een rapport, klantondersteuning of samenwerkingsmogelijkheden.
              </p>
              <p style={{ margin: 0, fontWeight: 700, color: "#0f172a" }}>E-mail</p>
              <p style={{ margin: "0.5rem 0 0" }}>
                <a href="mailto:info@gerustkopen.nl" style={{ color: "#2563eb" }}>info@gerustkopen.nl</a>
              </p>
              <p style={{ margin: "0.5rem 0 0" }}>
                <a href="mailto:support@gerustkopen.nl" style={{ color: "#2563eb" }}>support@gerustkopen.nl</a>
              </p>
            </div>
          )}
        </div>

        <aside className="input-card">
          <p style={{ margin: 0, color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em" }}>
            Rapport aanvragen
          </p>
          <h2 style={{ margin: "0.8rem 0 1rem" }}>Voer een adres of Funda-link in</h2>
          <p style={{ margin: "0 0 1.5rem", color: "#475569" }}>
            Wij maken een overzichtelijk huisrapport met een realistisch bodadvies, speciaal gericht op de huidige verkopersmarkt.
          </p>

          {!report ? (
            <>
              <form onSubmit={handleSubmit}>
                <label htmlFor="fundaLink" className="label">
                  Funda-link
                </label>
                <input
                  id="fundaLink"
                  value={fundaLink}
                  onChange={(e) => setFundaLink(e.target.value)}
                  placeholder="Plak een volledige Funda-link"
                  className="text-input"
                />
                <p style={{ margin: "0.5rem 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
                  Plak een volledige Funda-link.
                </p>
                <button type="submit" disabled={loading || fundaLink.trim() === ""} className="primary-button" style={{ marginTop: "1.25rem", width: "100%" }}>
                  {loading ? "Bezig met analyseren…" : "Rapport aanvragen"}
                </button>
              </form>

              {error && (
                <div className="status-message status-error">
                  <strong>Fout:</strong> {error}
                </div>
              )}

              <div style={{ marginTop: "1.5rem", color: "#475569" }}>
                <p style={{ margin: 0, fontWeight: 700 }}>Waarom dit rapport?</p>
                <p style={{ margin: "0.5rem 0 0" }}>
                  Het rapport maakt een zakelijke inschatting op basis van actuele marktdata en relevante woningkenmerken.
                </p>
              </div>
            </>
          ) : (
            <section className="report-card" style={{ marginTop: "1.75rem" }}>
              <div className="report-heading">
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", justifyContent: "space-between" }}>
                  <div>
                    <p style={{ margin: 0, color: "#2563eb", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 700 }}>
                      Gerustkopen.nl
                    </p>
                    <h2 style={{ marginTop: "0.5rem" }}>Download het PDF-rapport</h2>
                  </div>
                  <div style={{ textAlign: "right", color: "#475569", fontSize: "0.95rem" }}>
                    <div style={{ fontWeight: 700 }}>Gerustkopen.nl</div>
                    <div style={{ fontSize: "0.85rem" }}>Heldere rapporten voor particulieren</div>
                  </div>
                </div>
              </div>

              <div className="download-row" style={{ marginTop: "1.5rem" }}>
                <div>
                  <p style={{ margin: 0, color: "#475569" }}>
                    Klik op de knop om het rapport als PDF te downloaden.
                  </p>
                </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.75rem" }}>
                    <button type="button" className="primary-button download-button" onClick={handleDownloadPdf} style={{ width: "100%" }}>
                      Rapport downloaden
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => {
                        // Reset to allow a new request
                        setReport(null);
                        setDownloadMessage("");
                        setFundaLink("");
                      }}
                      style={{ width: "100%", background: "#e6eefc", color: "#0f172a" }}
                    >
                      Nieuwe aanvraag
                    </button>
                </div>
              </div>

              {downloadMessage && (
                <div className="status-message status-success" style={{ marginTop: "1rem" }}>
                  {downloadMessage}
                </div>
              )}

              {/* Debug info is hidden by default; only show toggle when debugInfo is present */}
              {report.debugInfo && (
                <div style={{ marginTop: "1rem" }}>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => setShowDebug((s) => !s)}
                    style={{ background: showDebug ? "#e6eefc" : undefined, color: showDebug ? "#0f172a" : undefined, padding: "0.5rem 0.75rem", borderRadius: 12, fontWeight: 700 }}
                  >
                    {showDebug ? "Verberg debug-info" : "Toon debug-info (developers)"}
                  </button>

                  {showDebug && (
                    <div style={{ marginTop: "1rem", background: "#f8fafc", padding: "0.75rem", borderRadius: "12px", border: "1px solid rgba(37,99,235,0.08)" }}>
                      <div style={{ color: "#475569", fontSize: "0.95rem" }}>
                        <strong>Vraagprijs:</strong> {report.listingPriceRaw || "Onbekend"} {report.listingPriceDetected ? "(uitgelezen)" : "(niet uitgelezen)"}
                      </div>

                      {report.wasClamped && (
                        <div className="status-message status-error" style={{ marginTop: "0.75rem" }}>
                          Het originele AI-advies is aangepast zodat het niet onder de vraagprijs komt.
                        </div>
                      )}

                      {report.originalBids && (
                        <div style={{ marginTop: "0.75rem" }}>
                          <strong>Originele AI-waarden:</strong>
                          <pre style={{ whiteSpace: "pre-wrap", marginTop: "0.5rem", fontSize: "0.9rem", color: "#334155" }}>{JSON.stringify(report.originalBids, null, 2)}</pre>
                        </div>
                      )}

                      <details style={{ marginTop: "0.75rem" }}>
                        <summary style={{ cursor: "pointer", fontWeight: 700, color: "#1d4ed8" }}>Debuginformatie</summary>
                        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: "0.75rem", color: "#334155" }}>{report.debugInfo}</pre>
                      </details>
                    </div>
                  )}
                </div>
              )}

              {report.debugInfo && (
                <details style={{ marginTop: "1.5rem", padding: "1rem", borderRadius: "16px", background: "#f8fafc", border: "1px solid rgba(37, 99, 235, 0.15)" }}>
                  <summary style={{ fontWeight: 700, cursor: "pointer", color: "#1d4ed8" }}>Debuginformatie weergeven</summary>
                  <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: "1rem", color: "#334155" }}>{report.debugInfo}</pre>
                </details>
              )}
            </section>
          )}
        </aside>
      </section>

      <section className="cta-banner">
        <div>
          <strong>Maak een zelfverzekerde biedingskeuze</strong>
          <p>Krijg direct een overzichtelijk rapport en handel met meer inzicht in de huidige huizenmarkt.</p>
        </div>
        <button type="button" className="primary-button" onClick={() => document.getElementById("fundaLink")?.focus()}>
          Start met je adres
        </button>
      </section>
    </main>
  );
}
