// House style guides for texts whose source is English.
//
// French: measured on GMT's own French (WorldTempus editorial + GMT Magazine, 404,546 sentences,
// train split). The counts quoted in the comments are occurrences in that corpus.
// German: the German guide of the French-source pipeline (trad_gmt/mt/style.py, STYLE_DE), with
// the cues given in English instead of French; counts are from the GMT Magazine German edition
// paired with its English text.

// « » 30,786 against “ ” 1,464; spaced « … » 27,139 against unspaced 3,645; space before
// : ; ! ? 49,857; ’ 286,705 against ' 134,406; " – " 11,729 against — 1,281; œ 8,014 against
// "oe" 746; 28'800 4,584 against 28 800 2,249; "CHF 16" 1,556 against "16 CHF" 777;
// "41 mm" 11,263 against "41mm" 2,846; "25%" 2,248 against "25 %" 591.
export const STYLE_FR = `Style maison — français de GMT Publishing (GMT Magazine, WorldTempus)

Ton
- Français de magazine, soigné et précis, pour amateurs et collectionneurs de montres. Écrire
  comme un rédacteur francophone, non comme un traducteur : refondre la syntaxe anglaise
  (noms en cascade, participes en tête de phrase, phrases courtes juxtaposées), éviter les
  anglicismes et les calques, sans jamais perdre d’information.
- Conserver le registre de l’original : un reportage reste élégant ; fiches techniques,
  légendes et listes restent brèves et en forme de liste (« Mouvement : calibre à remontage
  automatique… ; Boîtier : 41 mm, titane »).
- Titres : majuscule au premier mot et aux noms propres seulement, pas à chaque mot comme
  en anglais. Le lecteur est vouvoyé.

Orthographe et typographie
- Guillemets français « … » avec une espace à l’intérieur ; les guillemets anglais “…”
  deviennent « … » (“…” seulement à l’intérieur d’une citation).
- Une espace avant : ; ! ? ; apostrophe courbe ’.
- Tiret demi-cadratin entouré d’espaces « – » pour les incises, pas de tiret cadratin.
- Ligatures œ et æ (œuvre, cœur) ; majuscules accentuées (Étanche, À).
- Nombres : virgule décimale (1,63 carat) ; milliers séparés par une apostrophe, à la suisse
  (28'800) ; prix « CHF 16'800 », la devise avant le montant ; pourcentages « 25% ».

Conventions horlogères observées dans les textes de GMT
- "at 6 o’clock" → « à 6 h » ou « à 6 heures ».
- Dimensions avec une espace : « 41 mm », « un boîtier de 41 mm ».
- "28,800 vibrations per hour (4 Hz)" → « 28'800 alternances par heure (4 Hz) ».
- "water-resistant to 100 metres" → « étanche à 100 mètres » ou « étanche à 100 m ».
- "18-carat white gold" → « or blanc 18 carats » ou « or gris 18 carats » ; "rose gold",
  "pink gold" → « or rose ».
- "a 70-hour power reserve" → « une réserve de marche de 70 heures ».
- "timepiece" → « garde-temps » ou « montre » ; "hour-markers" → « index » ; "sapphire
  crystal" → « verre saphir » ; "caseback" → « fond » ; "strap", "bracelet" → « bracelet » ;
  "lugs" → « cornes » ; "small seconds" → « petite seconde ».
- "self-winding", "automatic" → « à remontage automatique », « automatique » ; "balance
  spring", "hairspring" → « spiral » ; "oscillating weight", "rotor" → « masse oscillante »,
  « rotor » ; "minute repeater" → « répétition minutes » ; "perpetual calendar" → « quantième
  perpétuel » ; "moon phase" → « phase de lune » ; "in-house movement" → « mouvement
  manufacture ».
- "limited edition of 50 pieces" → « édition limitée à 50 exemplaires ».
- "the Maison", "the Manufacture" → « la Maison », « la Manufacture » (avec majuscule) quand
  le texte désigne l’institution ; sinon « la marque ».
- Les noms de marque, de collection, de modèle, de calibre et de matériau restent exactement
  comme dans l’original (Royal Oak Perpetual Calendar, Calibre 5134, Parachrom, Oystersteel),
  avec leurs symboles ™ et ®.
`;

// movement → Werk 117 of 139, Kaliber 20, Uhrwerk 20; steel → Stahl 48 of 48 (Edelstahl 2);
// timepiece → Uhr 51, Zeitmesser 31 of 102; the Maison / the brand → Marke 122 of 141, Haus 10;
// white gold → Weissgold 13, Graugold 4; rose gold → Roségold 27 of 27; perpetual calendar →
// ewiger Kalender 24 of 28; lugs → Hörner 8, Bandanstösse 3.
export const STYLE_DE_FROM_EN = `Hausstil — GMT Magazine Deutsch (Uhrenmagazin)

Stimme
- Gewandtes, sachkundiges Magazindeutsch für Uhrenliebhaber und Sammler. Natürlich formulieren
  wie ein deutschsprachiger Redakteur: englische Satzmuster umbauen, Anglizismen und
  Nominalstil vermeiden, aber keine Information weglassen.
- Register der Vorlage beibehalten: Reportagen elegant und flüssig, technische Datenblätter
  knapp und als Liste ("Werk: Automatikkaliber …; Gehäuse: 41 mm, Titan").
- Leserinnen und Leser werden, falls nötig, mit "Sie" angesprochen.

Typografie
- Gedankenstrich mit Leerzeichen " – ". Dezimalkomma (1,63 Karat).
- Masse mit Leerzeichen: "41 mm"; als Kompositum mit Bindestrichen: "das 41-mm-Gehäuse".

Uhrmacherische Konventionen (wie GMT Magazine sie schreibt)
- "movement" → meist "Werk" oder "Kaliber", seltener "Uhrwerk"; "case" → "Gehäuse";
  "steel", "stainless steel" → "Stahl" (nicht "Edelstahl"); "timepiece" → "Uhr" oder
  "Zeitmesser".
- "the Maison", "the brand" → "die Marke" oder "das Haus", nicht "die Maison";
  "the Manufacture" → "die Manufaktur".
- "lugs" → "Hörner"; "white gold" → "Weissgold"; "rose gold", "pink gold" → "Roségold";
  "Côtes de Genève", "Geneva stripes" → "Genfer Streifen"; "oscillating weight", "rotor" →
  "Schwungmasse"; "power reserve" → "Gangreserve"; "perpetual calendar" → "ewiger Kalender";
  "self-winding" → "Automatikaufzug"; "small seconds" → "kleine Sekunde".
- "limited edition of 50 pieces" → "auf 50 Exemplare limitiert" / "limitierte Auflage von
  50 Exemplaren"; "at 6 o’clock" → "bei 6 Uhr"; "water-resistant to 100 metres" →
  "wasserdicht bis 100 m".
- Marken-, Kollektions-, Modell-, Kaliber- und Materialnamen exakt wie in der Vorlage
  belassen (Royal Oak Perpetual Calendar, Calibre 5134, Parachrom), inklusive ™/®.
`;
