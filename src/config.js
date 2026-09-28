// Game tuning, content tables and lore.

export const WORLD_HEIGHT = 9000; // summit at y = -WORLD_HEIGHT
export const BASE_ALT = 1850; // metres at y = 0
export const METRES_PER_PX = 0.12;

export const BODY = {
  shoulderX: 11,
  shoulderY: -20,
  hipX: 8,
  hipY: 22,
  arm: [28, 28],
  leg: [33, 33],
  standHeight: 81, // torso centre above feet when standing
};

// Difficulty levels. "easy" is the original balance; "normal" is the default.
export const DIFFICULTY = {
  easy: {
    name: 'Easy', blurb: 'The original balance. Plenty of rests, forgiving grip.',
    drain: 1, regen: 1, restEvery: 3, stepMul: 1, filler: 1, loose: 1, meander: 1,
    rockfall: 1, survival: 1, fallDamage: 1, slip: 0, start: {},
  },
  normal: {
    name: 'Normal', blurb: 'Fewer rest holds, longer reaches, hungrier and colder. A real climb.',
    drain: 1.4, regen: 0.75, restEvery: 4, stepMul: 1.08, filler: 0.72, loose: 1.7, meander: 1.35,
    rockfall: 1.5, survival: 1.3, fallDamage: 1.2, slip: 0, start: { chalk: 3, pitons: 5, porridge: 0 },
  },
  hard: {
    name: 'Alpinist', blurb: 'Tiny holds, big gaps, shaking hands. Every piton counts.',
    drain: 1.75, regen: 0.6, restEvery: 5, stepMul: 1.14, filler: 0.55, loose: 2.3, meander: 1.6,
    rockfall: 2, survival: 1.55, fallDamage: 1.4, slip: 0.18, start: { chalk: 2, pitons: 4, porridge: 0, meat: 0, water: 3 },
  },
};

export const HOLD_TYPES = {
  jug: { q: 1.25, r: 9, name: 'Jug' },
  crack: { q: 0.95, r: 7, name: 'Crack' },
  pocket: { q: 0.85, r: 6, name: 'Pocket' },
  crimp: { q: 0.6, r: 5, name: 'Crimp' },
  sloper: { q: 0.55, r: 10, name: 'Sloper' },
  ice: { q: 0.5, r: 8, name: 'Icy hold' },
  ledge: { q: 1.4, r: 6, name: 'Ledge' },
};

// y0 is the lower bound (closer to 0), y1 the upper bound (more negative).
export const ZONES = [
  {
    name: 'The Foothills', y0: 200, y1: -1600,
    rock: [120, 112, 98], dark: [70, 62, 55], light: [170, 160, 140],
    density: 0.0021, types: { jug: 5, pocket: 3, crimp: 2, crack: 1, sloper: 1 },
    step: [36, 46], overhang: 0, temp: 14, wind: 0, snow: 0, rockfall: 0, loose: 0.02,
  },
  {
    name: 'The Granite Shield', y0: -1600, y1: -4000,
    rock: [128, 124, 122], dark: [66, 64, 66], light: [190, 186, 180],
    density: 0.0017, types: { jug: 2, pocket: 3, crimp: 4, crack: 3, sloper: 1 },
    step: [38, 50], overhang: 0, temp: 10, wind: 0.1, snow: 0, rockfall: 1, loose: 0.06,
  },
  {
    name: 'The Red Roofs', y0: -4000, y1: -5600,
    rock: [140, 92, 70], dark: [80, 48, 38], light: [196, 140, 110],
    density: 0.0016, types: { jug: 4, pocket: 4, crimp: 2, crack: 2, sloper: 2 },
    step: [38, 48], overhang: 0.45, temp: 7, wind: 0.15, snow: 0, rockfall: 1.4, loose: 0.08,
  },
  {
    name: 'The Frozen Couloir', y0: -5600, y1: -7600,
    rock: [104, 112, 128], dark: [50, 56, 70], light: [200, 210, 225],
    density: 0.0017, types: { jug: 2, pocket: 2, crimp: 2, crack: 3, sloper: 2, ice: 3 },
    step: [36, 46], overhang: 0.1, temp: 0, wind: 0.35, snow: 0.6, rockfall: 0.8, loose: 0.05,
  },
  {
    name: 'The Summit Ridge', y0: -7600, y1: -9400,
    rock: [96, 98, 110], dark: [44, 46, 58], light: [230, 234, 242],
    density: 0.0014, types: { jug: 2, pocket: 2, crimp: 3, crack: 2, sloper: 2, ice: 3 },
    step: [36, 46], overhang: 0, temp: -4, wind: 1, snow: 1, rockfall: 0.3, loose: 0.04,
  },
];

export function zoneIndexAt(y) {
  for (let i = 0; i < ZONES.length; i++) {
    if (y <= ZONES[i].y0 && y > ZONES[i].y1) return i;
  }
  return y > 0 ? 0 : ZONES.length - 1;
}

export function zoneAt(y) {
  return ZONES[zoneIndexAt(y)];
}

// Bivouac ledges (y positions). The last one is the summit.
export const BIVOUACS = [
  { y: -330, name: 'Lichen Shelf' },
  { y: -1500, name: 'Shepherd\'s Rest' },
  { y: -2800, name: 'The Balcony' },
  { y: -4050, name: 'Ember Ledge' },
  { y: -5450, name: 'Hollow Bivouac' },
  { y: -6750, name: 'Frost Step' },
  { y: -8000, name: 'Last Light' },
  { y: -WORLD_HEIGHT, name: 'Summit of Veyra', summit: true },
];

export const ITEMS = {
  water: { name: 'Water', max: 6, desc: 'One sip: hydration +30' },
  berries: { name: 'Wild berries', max: 8, desc: 'Food +12, water +4' },
  mushroom: { name: 'Rock mushroom', max: 6, desc: 'Food +8 raw. Better cooked.' },
  herbs: { name: 'Mountain herbs', max: 6, desc: 'Warmth +6 raw. Brew into tea.' },
  meat: { name: 'Dried meat', max: 6, desc: 'Food +25' },
  bandage: { name: 'Bandage', max: 5, desc: 'Health +30' },
  chalk: { name: 'Chalk', max: 12, desc: 'Better grip for 45 s' },
  pitons: { name: 'Pitons', max: 14, desc: 'Protect falls. Hammer into cracks.' },
  // cooked meals
  porridge: { name: 'Berry porridge', max: 4, desc: 'Food +40, water +10' },
  marshmallow: { name: 'Marshmallows', max: 8, desc: 'Roast them at a bivouac fire' },
  stew: { name: 'Mountain stew', max: 4, desc: 'Food +55, health +12, warmth +10' },
  tea: { name: 'Herbal tea', max: 4, desc: 'Warmth +45, water +20' },
};

export const EAT_EFFECTS = {
  water: { hydration: 30 },
  berries: { satiety: 12, hydration: 4 },
  mushroom: { satiety: 8 },
  herbs: { warmth: 6 },
  meat: { satiety: 25 },
  bandage: { health: 30 },
  porridge: { satiety: 40, hydration: 10 },
  stew: { satiety: 55, health: 12, warmth: 10 },
  tea: { warmth: 45, hydration: 20 },
};

export const RECIPES = [
  { out: 'porridge', need: { berries: 2, water: 1 } },
  { out: 'stew', need: { mushroom: 1, meat: 1, water: 1 } },
  { out: 'tea', need: { herbs: 1, water: 1 } },
];

export const START_INVENTORY = {
  water: 4, berries: 2, meat: 1, bandage: 1, chalk: 4, pitons: 6,
  mushroom: 0, herbs: 0, porridge: 1, stew: 0, tea: 0, marshmallow: 3,
};

// Pickups found on the wall. zone weights index into ZONES.
export const PICKUPS = {
  berries: { weights: [5, 3, 1, 0, 0], amount: [2, 3], color: '#b0306a' },
  mushroom: { weights: [2, 3, 3, 1, 0], amount: [1, 2], color: '#d9b48a' },
  herbs: { weights: [2, 3, 2, 2, 1], amount: [1, 2], color: '#6fbf5a' },
  meat: { weights: [0, 1, 1, 1, 1], amount: [1, 1], color: '#8a4b2e', stash: true },
  bandage: { weights: [0, 1, 1, 1, 1], amount: [1, 1], color: '#e9e2d0', stash: true },
  chalk: { weights: [1, 2, 2, 2, 2], amount: [2, 3], color: '#f4f4f4', stash: true },
  pitons: { weights: [0, 2, 2, 2, 2], amount: [1, 2], color: '#9aa6b2', stash: true },
  water: { weights: [3, 3, 2, 3, 1], amount: [6, 6], color: '#6bc7ff', spring: true },
};

// ---- Journal (collection) --------------------------------------------------

export const FLORA = [
  { id: 'aster', name: 'Alpine Aster', zone: 0, text: 'Purple petals that close before a storm. The shepherds call it "the honest flower".' },
  { id: 'saxifrage', name: 'Purple Saxifrage', zone: 0, text: 'Its name means "stone-breaker". It splits granite one root at a time.' },
  { id: 'jasmine', name: 'Rock Jasmine', zone: 1, text: 'A cushion of tiny white stars clinging to bare rock. Patience made visible.' },
  { id: 'edelweiss', name: 'Edelweiss', zone: 1, text: 'Woolly and silver. Grows only where few dare to climb.' },
  { id: 'campion', name: 'Moss Campion', zone: 2, text: 'Pink cushion that grows a centimetre a year. This one is older than you.' },
  { id: 'gentian', name: 'Snow Gentian', zone: 3, text: 'A shock of blue in the ice. It blooms the day the snow lets go.' },
  { id: 'buttercup', name: 'Glacier Buttercup', zone: 4, text: 'The highest flowering plant ever found. It does not care that you are here.' },
  { id: 'alpenrose', name: 'Alpine Rose', zone: 0, ground: true, text: 'A shrub that turns whole slopes pink in June. Tobi says Mara always wore one on her pack.' },
  { id: 'arnica', name: 'Arnica', zone: 0, ground: true, text: 'Bright yellow and bitter. Every shepherd\'s cure for bruises. You will collect a few of those.' },
];

// Scout-style badges (inspired by PEAK), kept across all your climbs.
export const BADGES = [
  { id: 'camper', name: 'Happy Camper', text: 'Make camp on a bivouac.' },
  { id: 'hammer', name: 'Hammer Time', text: 'Hammer 10 pitons in one climb.' },
  { id: 'dyno', name: 'Dyno!', text: 'Land a lunge to a hold out of reach.' },
  { id: 'golden', name: 'Golden Roast', text: 'Roast a perfect marshmallow.' },
  { id: 'friends', name: 'Old Friends', text: 'Talk to both Tobi and Kip.' },
  { id: 'owl', name: 'Night Owl', text: 'Climb 100 m in the dark.' },
  { id: 'botanist', name: 'Botanist', text: 'Find every flower on Veyra.' },
  { id: 'spotter', name: 'Spotter', text: 'Record every animal.' },
  { id: 'summit', name: 'Summit', text: 'Stand on top of Veyra.' },
  { id: 'clean', name: 'Clean Ascent', text: 'Reach the summit without a single fall.' },
  { id: 'alpinist', name: 'Alpinist', text: 'Reach the summit on Alpinist.' },
  { id: 'daily', name: 'Daily Climber', text: 'Summit the mountain of the day.' },
];

export const FAUNA = [
  { id: 'marmot', name: 'Marmot', zone: 0, kind: 'ledge', text: 'It whistles a warning to the whole valley. You are the danger, apparently.' },
  { id: 'chough', name: 'Alpine Chough', zone: 1, kind: 'fly', text: 'Yellow beak, black feathers, zero respect for gravity.' },
  { id: 'wallcreeper', name: 'Wallcreeper', zone: 2, kind: 'wall', text: 'Crimson wings flicker like a match struck against the rock.' },
  { id: 'ibex', name: 'Ibex', zone: 2, kind: 'ledge', text: 'Standing on a ledge you would need three pitons to reach. Show-off.' },
  { id: 'hare', name: 'Mountain Hare', zone: 3, kind: 'ledge', text: 'Already in its white winter coat. It knows something about the weather.' },
  { id: 'eagle', name: 'Golden Eagle', zone: 4, kind: 'fly', text: 'It circles above the summit. The only one here who climbs without effort.' },
  { id: 'chamois', name: 'Red Fox', zone: 0, kind: 'meadow', text: 'It hunts mice along the lake shore and pretends not to see you. It sees you.' },
];

// The valley at the foot of the wall, where you can walk around (x along the wall, z away from it).
export const VALLEY = {
  x0: -1450, x1: 1450, z0: 0, z1: 1050,
  camp: { x: -300, z: 250 },
  tobi: { x: -262, z: 282 },
  robot: { x: -205, z: 215 },
  lake: { x: 560, z: 640, r: 190 },
  waterfall: { x: 430, top: -640 },
};

export const KIP_LINES = [
  ['BEEP. Unit K-1P, expedition support robot. Mara called me Kip.', 'I waited at base camp. She said she would be back by the weekend. That was nine years ago.', 'If you reach the summit, tell her cairn that Kip says hello. BOOP.'],
  ['My knees are rusty but my sensors are sharp: the red roofs drain your grip. Rest on the big holds.'],
  ['Pip is my little cousin. Pip is very polite. I was never polite. BEEP.'],
  ['Weather report: cold at the top, colder at night. Pack tea. Tea is warm. I cannot drink tea.'],
  ['The fox by the lake steals Tobi\'s socks. I have evidence. I have no one to show it to.'],
];

export const TOBI_LINES = {
  first: [
    'Another one going up Veyra, eh? Sit a minute. I\'m Tobi.',
    'Nine years ago I climbed this wall with Mara. I turned back at Frost Step. She didn\'t.',
    'Take these, they\'re no use to me down here. And rest on every shelf. She always said that.',
  ],
  relic: [
    'You found her things up there? Her map, her journal... She wrote about me?',
    'Keep climbing. If her stone is up there, it belongs on the summit.',
  ],
  summit: [
    'You stood on top. You put her stone on the cairn.',
    'Thank you. I think I can finally stop looking up at that wall.',
  ],
  idle: [
    'Berries on those bushes grow back every morning. Eat before you climb.',
    'The lake water is cold, but it\'s the best on the mountain. Fill your flask.',
    'Chalk before the crimps, not after. Your fingers will thank you.',
    'If a hold sounds hollow when you grab it, let go of it. Fast.',
    'The chamois come to the lake at dawn. You\'ll never catch one, but you might see one.',
    'Pip found half our pitons last time. That little robot never complained once.',
  ],
};

export const RELICS = [
  { id: 'r1', name: 'Torn Map', text: 'Mara\'s map of Veyra. "Seven shelves to the top," she wrote. "Rest on every one of them, idiot." It is addressed to someone named Tobi.' },
  { id: 'r2', name: 'Rusty Carabiner', text: 'Engraved: M + T. Whoever they were, they climbed together.' },
  { id: 'r3', name: 'Journal Page (Day 3)', text: '"Tobi wants to go fast. I want to come home. The mountain only hears one of us."' },
  { id: 'r4', name: 'Broken Headlamp', text: 'The battery is long dead. Scratched on the side: "Don\'t climb at night. Seriously."' },
  { id: 'r5', name: 'Journal Page (Day 6)', text: '"The roofs took all our pitons. The little robot went back down for them. I love that robot."' },
  { id: 'r6', name: 'Frozen Glove', text: 'A single mitten, child-sized, knitted by hand. Someone brought their kid\'s glove for luck.' },
  { id: 'r7', name: 'Journal Page (Day 9)', text: '"Tobi turned back at Frost Step. I went on alone. If you are reading this — I made it. Build a cairn for me."' },
  { id: 'r8', name: 'Mara\'s Cairn Stone', text: 'A flat stone with a painted M. It belongs on the summit cairn.' },
];

export const CLIMBOT_TIPS = {
  start: 'Hi! I\'m Pip, your climbot. Click a hold to reach for it. Drag a hand or foot for precise moves.',
  stamina: 'Your grip is fading! Get more limbs on good holds, or chalk up with C.',
  crack: 'That crack would take a piton. Press F while holding it.',
  camp: 'A bivouac! Press E to make camp. I can fetch the pitons you left below.',
  hungry: 'Your stomach is growling louder than the wind. Eat something (I).',
  thirsty: 'You need water. Springs drip down the rock — look for wet streaks.',
  cold: 'You\'re freezing. Tea and a campfire would help.',
  night: 'It\'s getting dark. Climbing at night is cold and dangerous.',
  loose: 'That hold is crumbling! Move off it!',
  rope: 'Caught by the rope! W/S to climb or lower, A/D to swing. Hang still to rest your arms, then click a hold to grab it.',
  noPitons: 'Out of pitons. Make camp and I\'ll fetch the ones below.',
  flower: 'Ooh, a rare plant! Reach for it to add it to your journal.',
  fauna: 'Look! Click the animal to record a sighting in your journal.',
  walk: 'Welcome to the valley! WASD to walk, drag with the mouse to look around, E to talk or pick things. Click a hold on the wall to start climbing.',
  wind: 'Strong gusts up here. Keep three points of contact!',
};
