# Navimoto

Navimoto is een mobile-first Progressive Web App (PWA) voor motorrijders. Je plant er routes mee die
draaien om rijplezier (bochten, kleine wegen, avontuur), laat rondritten genereren, gebruikt GPX-bestanden
en navigeert met gesproken instructies. Kaartdata en routering zijn gebaseerd op OpenStreetMap.

## Functies

- **Drie tabs**: *Ritten* (opgeslagen routes en gereden ritten), *Kaart* (plannen en verkennen) en
  *Profiel* (account, rijderstype en voorkeuren).
- **Route plannen** met start, bestemming en via-punten. Punten kies je door te zoeken op plaats of adres
  of door een punt op de kaart aan te wijzen.
- **Rondrit genereren**: geef een gewenste afstand op en Navimoto maakt een lus vanaf je startpunt.
  Met *Opnieuw genereren* krijg je een andere lus.
- **Rijstijlen**: *Avontuurlijk* (kleine wegen, afwisselend landschap en, afhankelijk van je rijderstype,
  onverharde stukken), *Bochtig* (zo veel mogelijk bochten, zo min mogelijk snelweg) en *Snel* (de snelste
  route, snelwegen toegestaan).
- **Vermijden** van veerponten, snelwegen, tolwegen en onverharde wegen.
- **GPX**: bestanden importeren, opslaan, exporteren en rijden. Een geïmporteerd spoor wordt bij het
  starten op het wegennet gelegd (map-matching), zodat je ook daar afslaginstructies krijgt.
- **Navigatie** met gesproken instructies (Nederlands), automatische herberekening als je van de route
  afwijkt en ritregistratie (afstand, duur, rijtijd, gemiddelde en maximale snelheid). Het scherm blijft
  tijdens het rijden aan.
- **Rijderstype**: *Street* (alleen verharde wegen), *Offroad* (zoekt onverharde wegen en paden op) of
  *Allroad* (een mix van verhard en onverhard). Dit beïnvloedt de routering.
- **Kaartlagen**: Standaard (OpenStreetMap), Topografisch (OpenTopoMap) en CyclOSM.
- **Accounts**: lokaal in de browser (zonder server) of via Supabase (e-mail en wachtwoord). Je kunt ook
  doorgaan als gast.
- **Demo-modus**: simuleer een rit over de geplande route zonder echte GPS, handig om de navigatie thuis
  te bekijken.

Routes en ritten worden lokaal op het toestel bewaard (IndexedDB), ook als je met een Supabase-account
bent ingelogd. Synchronisatie naar de cloud staat op de roadmap.

## Techniek

| Onderdeel | Keuze |
|---|---|
| UI | React 19, TypeScript (strict), Vite 7, Tailwind CSS v4 (donker thema), lucide-react |
| Kaart | MapLibre GL met rastertegels van OpenStreetMap, OpenTopoMap en CyclOSM |
| State | Zustand |
| Opslag | Dexie (IndexedDB) voor profielen, routes, ritten en lokale accounts |
| Routering | Valhalla (`/route` en `/trace_route`, costing `motorcycle`) |
| Zoeken | Photon (komoot) |
| Adres bij coördinaat | Nominatim (reverse geocoding) |
| Accounts | Lokaal (PBKDF2-gehashte wachtwoorden in IndexedDB) of Supabase Auth |
| PWA | vite-plugin-pwa (manifest, service worker, cache van app-bestanden en recent bekeken tegels) |
| Tests | Vitest (node-omgeving, fake-indexeddb, jsdom waar nodig) |

Mappen in het kort:

```
src/pages/        pagina's (Login, Kaart, Ritten, Route- en Ritdetail, Profiel, Navigatie)
src/components/   MapView, planner, tabbalk en de UI-primitieven (src/components/ui)
src/store/        zustand-stores (auth, instellingen, ritten, locatie, navigatie, planner)
src/services/     routing (Valhalla), rondrit, geocoding, database (Dexie), auth-providers
src/lib/          pure hulpfuncties (geo, gpx, format, navigatielogica, spraak, wake lock)
supabase/         schema.sql voor een eigen Supabase-project
scripts/          gen-icons.mjs genereert de PNG-iconen in public/icons
```

## Aan de slag

Vereist: Node.js 20.19+ of 22.12+ (de minimumversie van Vite 7).

```bash
npm install
npm run dev          # ontwikkelserver op http://localhost:5173 (ook bereikbaar in je netwerk)
npm run build        # typecheck + productiebuild in dist/
npm run test         # vitest
npm run typecheck    # tsc --noEmit
```

Let op: de browser geeft alleen toegang tot GPS in een beveiligde context (`https://` of `localhost`).
Wil je op een telefoon testen via het lokale netwerk, gebruik dan een https-tunnel of de demo-modus
(in te schakelen op het tabblad *Profiel*).

## Omgevingsvariabelen

Kopieer `.env.example` naar `.env`. Alle variabelen zijn optioneel.

| Variabele | Betekenis |
|---|---|
| `VITE_SUPABASE_URL` | URL van je Supabase-project. Samen met de anon key schakelt dit Supabase-accounts in. |
| `VITE_SUPABASE_ANON_KEY` | De publieke *anon key* van je Supabase-project. |
| `VITE_VALHALLA_URL` | Eigen Valhalla-server. Standaard: `https://valhalla1.openstreetmap.de`. |

Zonder Supabase-variabelen werkt Navimoto met lokale accounts die alleen in de browser van het toestel
bestaan.

### Supabase inschakelen

1. Maak een project aan op [supabase.com](https://supabase.com).
2. Open in het dashboard de *SQL Editor* en voer de inhoud van `supabase/schema.sql` uit.
3. Ga naar *Authentication → Providers* en zet **Email** aan. Voor snel testen kun je *Confirm email*
   uitzetten; anders moeten gebruikers eerst hun e-mailadres bevestigen.
4. Kopieer onder *Project Settings → API* de *Project URL* en de *anon public key* naar `.env`
   (`VITE_SUPABASE_URL` en `VITE_SUPABASE_ANON_KEY`).
5. Start de ontwikkelserver opnieuw. Navimoto herkent de variabelen automatisch en gebruikt vanaf dan
   Supabase voor inloggen en registreren.

## Databronnen en gebruiksvoorwaarden

Navimoto gebruikt gratis, publieke diensten van de OpenStreetMap-gemeenschap. Die zijn bedoeld voor licht
gebruik en ontwikkeling; houd je aan de voorwaarden van elke dienst.

- **Kaarttegels** (`tile.openstreetmap.org`, OpenTopoMap, CyclOSM): de
  [OSM-tegelpolicy](https://operations.osmfoundation.org/policies/tiles/) staat geen zwaar gebruik of
  distributie van apps op de standaardtegelserver toe. Gebruik voor productie een eigen tegelserver of een
  commerciële tegelaanbieder en pas `TILE_SOURCES` in `src/components/MapView.tsx` aan.
- **Valhalla** (`valhalla1.openstreetmap.de`): publieke demoserver van FOSSGIS zonder SLA of garanties.
  Voor productie zet je een eigen Valhalla-server op en vul je `VITE_VALHALLA_URL` in.
- **Nominatim** (reverse geocoding): maximaal 1 verzoek per seconde, geen bulkverzoeken; zie de
  [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/).
- **Photon** (`photon.komoot.io`): gratis zoekdienst van komoot, fair use en zonder garanties.
- **Attributie is verplicht**: de vermelding *© OpenStreetMap-bijdragers* (plus OpenTopoMap en CyclOSM waar
  van toepassing) moet zichtbaar blijven op de kaart. OpenStreetMap-data valt onder de
  [ODbL](https://www.openstreetmap.org/copyright).

## Installeren als app

Navimoto is een PWA en kan als app op je beginscherm worden gezet:

- **Android (Chrome)**: open de site, kies in het menu *App installeren* of *Toevoegen aan startscherm*.
- **iPhone/iPad (Safari)**: tik op de deelknop en kies *Zet op beginscherm*.

De app opent daarna schermvullend (staand, donker thema). De app-bestanden worden gecachet zodat de app
ook zonder verbinding start; kaarttegels zijn alleen beschikbaar voor gebieden die je recent hebt bekeken.
Route berekenen, zoeken en herberekenen tijdens het rijden hebben een internetverbinding nodig.

## App-iconen

`public/icons/icon.svg` is het bronicoon. De PNG-varianten (192, 512 en 512 *maskable*) genereer je met:

```bash
node scripts/gen-icons.mjs
```

Het script heeft geen afhankelijkheden en schrijft de PNG's rechtstreeks (eigen rasterisatie, zlib en CRC32).

## Roadmap

- Capacitor-build voor de App Store en Play Store.
- Cloud-synchronisatie van routes en ritten via Supabase.
- Offline kaarten (tegels downloaden per gebied).
- Import van TomTom- en Garmin-routes.

## Online zetten (GitHub Pages)

De app draait op https://ryanvos5.github.io/navimoto/ (branch `gh-pages`). Opnieuw publiceren na wijzigingen:

```bash
npm run deploy
```

Dit bouwt de app met basispad `/navimoto/` en pusht de map `dist` naar `gh-pages`. Locatie (GPS) werkt alleen via HTTPS, dus test dit op je telefoon via de bovenstaande link.
