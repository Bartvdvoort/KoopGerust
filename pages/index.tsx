import { useState, type FormEvent } from "react";
import jsPDF from "jspdf";

type Report = {
  address: string;
  valueExplanation: string;
  recommendedBid: string;
  detailedExplanation: string;
  viewingAdvice: string;
  neighborhoodInfo: string;
  debugInfo?: string;
};

export default function Home() {
  const [straat, setStraat] = useState("");
  const [huisnummer, setHuisnummer] = useState("");
  const [postcode, setPostcode] = useState("");
  const [fundaLink, setFundaLink] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloadMessage, setDownloadMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"advies" | "overOns" | "contact">("advies");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setReport(null);
    setLoading(true);

    const fundaRegex = /(https?:\/\/)?(www\.)?funda\.nl\/[^\s]+/i;

    let queryToSend = "";
    if (fundaLink.trim()) {
      if (!fundaRegex.test(fundaLink.trim())) {
        setError("Ongeldige Funda-link. Gebruik een volledige URL van funda.nl.");
        setLoading(false);
        return;
      }
      queryToSend = fundaLink.trim();
    } else {
      if (!straat.trim() || !huisnummer.trim() || !postcode.trim()) {
        setError("Vul alle velden in: Straatnaam, Huisnummer en Postcode, of plak een Funda-link.");
        setLoading(false);
        return;
      }
      const normalizedPostcode = postcode.replace(/\s+/g, "").toUpperCase();
      queryToSend = `${straat.trim()} ${huisnummer.trim()}, ${normalizedPostcode}`;
    }

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
    const maxWidth = 178;
    let y = 20;

    doc.setFontSize(18);
    doc.text("Huisrapport", margin, y);
    y += 12;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Aanbevolen bod", margin, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    const bidLines = doc.splitTextToSize(report.recommendedBid, maxWidth);
    doc.text(bidLines, margin, y);
    y += bidLines.length * 6 + 10;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Toelichting", margin, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    const detailLines = doc.splitTextToSize(report.detailedExplanation, maxWidth);
    doc.text(detailLines, margin, y);
    y += detailLines.length * 6 + 10;

    const sections = [
      { title: "Waarde", text: report.valueExplanation },
      { title: "Bezichtigingsadvies", text: report.viewingAdvice },
      { title: "Woonwijkinformatie", text: report.neighborhoodInfo },
    ];

    sections.forEach(({ title, text }) => {
      if (y > 275) {
        doc.addPage();
        y = 20;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(title, margin, y);
      y += 8;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      const lines = doc.splitTextToSize(text, maxWidth);
      doc.text(lines, margin, y);
      y += lines.length * 6 + 10;
    });

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
                <label htmlFor="straat" className="label">
                  Straatnaam
                </label>
                <input
                  id="straat"
                  value={straat}
                  onChange={(e) => setStraat(e.target.value)}
                  placeholder="Straatnaam"
                  className="text-input"
                />
                <label htmlFor="huisnummer" className="label">
                  Huisnummer
                </label>
                <input
                  id="huisnummer"
                  value={huisnummer}
                  onChange={(e) => setHuisnummer(e.target.value)}
                  placeholder="Huisnummer"
                  className="text-input"
                />
                <label htmlFor="postcode" className="label">
                  Postcode
                </label>
                <input
                  id="postcode"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  placeholder="Postcode"
                  className="text-input"
                />
                {/* Stad removed: only straat, huisnummer, postcode required */}
                <label htmlFor="fundaLink" className="label">
                  Funda-link (optioneel)
                </label>
                <input
                  id="fundaLink"
                  value={fundaLink}
                  onChange={(e) => setFundaLink(e.target.value)}
                  placeholder="Funda-link"
                  className="text-input"
                />
                <p style={{ margin: "0.5rem 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
                  Vul in als: <strong>Straatnaam, Huisnummer, Postcode</strong> of plak een volledige Funda-link.
                </p>
                <button type="submit" disabled={loading || (!fundaLink.trim() && (straat.trim() === "" || huisnummer.trim() === "" || postcode.trim() === ""))} className="primary-button" style={{ marginTop: "1.25rem", width: "100%" }}>
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
                <p style={{ margin: 0, color: "#2563eb", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 700 }}>
                  Rapport gereed
                </p>
                <h2 style={{ marginTop: "0.5rem" }}>Download het PDF-rapport</h2>
              </div>

              <div className="download-row" style={{ marginTop: "1.5rem" }}>
                <div>
                  <p style={{ margin: 0, color: "#475569" }}>
                    Klik op de knop om het rapport als PDF te downloaden.
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button type="button" className="primary-button download-button" onClick={handleDownloadPdf}>
                    Download PDF
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      // Reset to allow a new request
                      setReport(null);
                      setDownloadMessage("");
                      setStraat("");
                      setHuisnummer("");
                      setPostcode("");
                      setFundaLink("");
                    }}
                    style={{ background: "#e6eefc", color: "#0f172a" }}
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
        <button type="button" className="primary-button" onClick={() => document.getElementById("straat")?.focus()}>
          Start met je adres
        </button>
      </section>
    </main>
  );
}
