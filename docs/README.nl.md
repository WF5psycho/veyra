# VEYRA — klim-survivalgame (geïnspireerd op *Cairn*)

Beklim de berg Veyra (1.850 m → 2.930 m) hand voor hand. Elke greep is een keuze, elke richel een thuis.
Vrij klimmen met vier losse ledematen, uithoudingsvermogen, touw & haken, bivaks, koken, overleven,
een robotje (Pip) dat je haken terughaalt, en een verzameldagboek met planten, dieren en relikwieën.

Speelbaar in **3D** (standaard, three.js) en **2D** — wisselen met **V** of via *Settings*.

**Nieuw: de vallei.** Onderaan de berg loop je vrij rond in 3D: een basiskamp met Tobi (de oude klimpartner
uit het dagboekverhaal, praat met **E**), bessenstruiken, paddenstoelen en kruiden die elke dag teruggroeien,
een meer om water te tappen, een waterval met beek, bossen, bloemenweides, een gems bij het meer en nieuwe
dagboekplanten. Op bivakrichels kun je ook rondlopen. Klik een greep op de wand en je loopt erheen en begint te klimmen.

**Mooiere 3D-natuur:** echte lucht met zon, sterren en maan, een ring van besneeuwde toppen rondom, een
wolkenzee waar je doorheen klimt, vogels, bossen op de flanken, een puntige top, en filmische belichting.

## Spelen

- **Makkelijkst:** open `dist/veyra.html` (dubbelklik). Alles zit in één bestand, geen installatie of internet nodig.
- **Ontwikkelversie:** `npm start` en ga naar <http://localhost:8080>.

## Besturing

| Actie | Toets / muis |
|---|---|
| Greep pakken | **Klik op een greep** — de beste hand/voet reikt ernaar |
| Precies plaatsen | **Sleep** een hand of voet (het rondje) naar een greep |
| Ledemaat kiezen | **1–4** (linkerhand, rechterhand, linkervoet, rechtervoet) · rechtsklik = annuleren/loslaten |
| Gewicht verplaatsen / rondlopen (3D: alle kanten, Shift = rennen) | **WASD** / pijltjes |
| Rondkijken (3D) | slepen met de muis op lege plek, of rechts-slepen |
| Praten / plukken / water tappen | **E** |
| Op een richel klimmen | **W** (of Spatie) als je handen op de rand liggen |
| Haak slaan | **F** terwijl een hand in een scheur zit, daarna 3× F in het groen |
| Magnesium | **C** |
| Drinken | **T** |
| Rugzak / Dagboek | **I** / **J** |
| Kamp opslaan bij bivak | **E** |
| Touw: klimmen/zakken, slingeren | **W/S**, **A/D** |
| 2D ⇄ 3D, muziek, pauze | **V**, **M**, **Esc** |
| Zoomen | muiswiel |

## Spelsystemen

- **Uithoudingsvermogen** (ring naast de klimmer): leegt als je armen het werk doen op kleine grepen
  (crimps, slopers, ijs) en vult bij goede grepen met je voeten eronder. Op nul laten je handen los.
- **Vallen:** zonder touw is een lange val dodelijk. Een geslagen haak vangt je op (slechte haken kunnen losschieten).
- **Overleven:** eten, water en warmte verlagen je maximale kracht als ze op raken. Het is koud hoog en 's nachts.
  Bronnen (natte strepen op de rots) vullen je fles.
- **Bivaks (7):** koken (pap, stoofpot, thee), slapen, fles vullen, **Pip** je haken laten halen, een **cairn** bouwen (= opslaan).
- **Gevaren:** vallende stenen (waarschuwing ▼ bovenin), afbrokkelende grepen, windstoten op de top, nacht.
- **Dagboek:** 7 planten, 6 dieren (klik erop), 8 relikwieën van een eerdere expeditie met een eigen verhaal.
- **5 zones:** The Foothills, The Granite Shield, The Red Roofs (overhang), The Frozen Couloir, The Summit Ridge.

## Code

```
src/config.js     tuning, zones, items, recepten, dagboekteksten
src/world.js      procedurele berg: grepen, scheuren, richels, bivaks, pickups
src/climber.js    klimfysica: ledematen, lichaam-solver, stamina, vallen, touw
src/game.js       overleven, inventaris, haken, kamp, gevaren, Pip, dagboek, opslaan
src/autoclimb.js  AI-klimmer (tests + demo op het titelscherm)
src/render2d.js   2D canvas-weergave (alles procedureel getekend)
src/render3d.js   3D-weergave met three.js (berg met flanken, klimmer + loopanimatie, camera, licht)
src/env3d.js      3D-natuur: lucht, toppen, vallei, bos, meer, waterval, basiskamp, Tobi, wolken, vogels
src/audio.js      alle geluid gesynthetiseerd (WebAudio), generatieve muziek
src/ui.js         HUD en menu's
src/main.js       game loop, besturing
tools/build.mjs   bundelt alles naar dist/veyra.html
```

## Testen

```
npm test          # headless simulatie: wereldgeneratie, klimmen, touw, opslaan, dood,
                  # en een AI-klimmer die op 3 bergen de top haalt (ook met gevaren + overleven)
npm run test:e2e  # headless Chromium: speelt het spel, klikt grepen, test menu's en 3D, maakt screenshots
npm run build     # maakt dist/veyra.html
```

Alle graphics en geluiden worden door code gemaakt (geen externe assets). three.js (MIT) staat in `vendor/`.
