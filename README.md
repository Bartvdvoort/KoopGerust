# Huisprijzen AI

Een Next.js-project met een eenvoudige gebruikersinterface en een AI-backend voor het inschatten van woningwaarde en een realistisch biedadvies.

## Functionaliteit

- invoeren van een adres of Funda-link
- backend scrapt data van Funda (indien een Funda-link is opgegeven)
- AI genereert een waardeanalyse, bodadvies en uitgebreide toelichting

## Technologie

- Next.js 14
- React
- OpenAI API
- cheerio voor HTML-scraping
- node-fetch voor HTTP-aanvragen

## Installatie

1. Open een terminal in `C:\Users\Bart\huisprijzen-ai`
2. Installeer dependencies:

```bash
npm install
```

3. Kopieer het voorbeeldbestand naar `.env`:

```bash
copy .env.example .env
```

4. Vul je OpenAI API-sleutel in `.env`:

```env
OPENAI_API_KEY=sk-...
DEBUG_PROMPT=false
```

## Debugmodus

Als je de gegenereerde prompt en het modelantwoord wilt loggen, zet dan in `.env`:

```env
DEBUG_PROMPT=true
```

De server logt dan de prompt en het OpenAI-antwoord, en het rapport kan een extra debugsectie bevatten in de UI.

## Lokaal draaien

Start de ontwikkelserver:

```bash
npm run dev
```

Open vervolgens in je browser:

```text
http://localhost:3000
```

## Gebruik

- Voer een adres in of plak een Funda-link
- Klik op "Rapport genereren"
- Het rapport verschijnt met waarde, bod en toelichting

## Opmerkingen

- Funda-scraping kan breken als de site-structuur verandert.
- De AI geeft een inschatting en geen bindend juridisch advies.
- Voor productie is het beter om een betrouwbare dataset of officiële API te gebruiken.
