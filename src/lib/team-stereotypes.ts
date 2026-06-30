const RAW_STEREOTYPES: Record<string, string> = {
  netherlands: "oranje chaos merchants—beautiful until the wheels come off",
  holland: "oranje chaos merchants—beautiful until the wheels come off",
  norway: "viking longball romantics who believe in Haaland and miracles",
  france: "absurd depth of talent who occasionally remember they hate each other",
  sweden: "blonde efficiency with a secret love of set-piece drama",
  mexico: "eternal optimists who party like they've already won",
  ecuador: "altitude bandits who run forever and never stop believing",
  brazil: "samba merchants who turn it on when the mood strikes",
  argentina: "messi tax collectors with bite and divine intervention",
  germany: "efficiency goblins who turn up with spreadsheets and pain",
  england: "penalty merchants forever one heartbreak from a national crisis",
  spain: "tiki-taka possession vampires who bore you into submission",
  portugal: "ronaldo-powered chaos with a flair for the dramatic",
  italy: "defensive sorcerers who will park the bus and still score",
  uruguay: "bitey underdogs who will fight god for a result",
  japan: "disciplined technicians who counter like they've studied your soul",
  southkorea: "red wave of stamina and set-piece terror",
  "south korea": "red wave of stamina and set-piece terror",
  "korea republic": "red wave of stamina and set-piece terror",
  "united states": "athletic experimenters who just might nick it",
  usa: "athletic experimenters who just might nick it",
  canada: "surprising upstarts with maple leaf heart",
  australia: "socceroo larrikins who run until the final whistle",
  croatia: "resilient midfield warlocks who refuse to die",
  belgium: "golden generation ghosts still looking for their moment",
  denmark: "viking pragmatists who will happily ruin your evening",
  poland: "lewandowski and a wall—take it or leave it",
  switzerland: "organized neutrality with a nasty counter",
  senegal: "teranga lions who bring speed and belief",
  morocco: "atlas lions who defend like their lives depend on it",
  tunisia: "desert foxes who love a giant-killing",
  cameroon: "indomitable lions—unpredictable and proud",
  ghana: "black stars with a taste for the theatrical",
  nigeria: "super eagles who can fly or fall apart in five minutes",
  "saudi arabia": "oil money underdogs with a puncher's chance",
  qatar: "hosts who always seem to find an extra gear at home",
  iran: "stubborn resistance with dangerous set pieces",
  "new zealand": "all whites who will run through walls",
};

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getTeamStereotype(team: string): string {
  const key = normalize(team);
  if (RAW_STEREOTYPES[key]) return RAW_STEREOTYPES[key];

  // Try without spaces for compound names
  const compact = key.replace(/\s/g, "");
  if (RAW_STEREOTYPES[compact]) return RAW_STEREOTYPES[compact];

  // Fallback goblin flavor
  return "plucky outsiders with a point to prove and nothing to lose";
}

export function getStereotypesForMatch(home: string, away: string): string {
  const h = getTeamStereotype(home);
  const a = getTeamStereotype(away);
  return `${home}: ${h}. ${away}: ${a}.`;
}
