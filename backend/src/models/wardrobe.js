// The wardrobe: what a character can be dressed in.
//
// Kept on the SERVER, not only in the app, because both phones have to agree
// on what the other person is wearing. If the catalogue lived only in the
// client, a phone on an older build would render an outfit it had never heard
// of — and the sensible fallback for "unknown garment" is nothing at all,
// which is not a fallback anyone wants for trousers.
//
// So the server validates against this list and the client draws from it. A
// garment added here is rejected by an old client cleanly rather than
// silently undressing anybody.

export const SKINS = {
  porcelain: '#F3D7C4', light: '#E8BE9C', medium: '#C98C63',
  tan: '#A96A44', deep: '#7A4A2B', rich: '#5A3520',
};

export const HAIR_COLORS = {
  black: '#1E1A1C', darkBrown: '#3B2A22', brown: '#6B4530',
  auburn: '#8C4A2F', blonde: '#C9995C', grey: '#9A9490',
  pink: '#E36FA0', blue: '#4C6FD1', green: '#3F8F6B',
};

// `shape` is what the renderer switches on; the label is what a person picks.
export const HAIR_STYLES = {
  short: { label: 'Short', shape: 'short' },
  fade: { label: 'Fade', shape: 'fade' },
  locs: { label: 'Locs', shape: 'locs' },
  afro: { label: 'Afro', shape: 'afro' },
  curls: { label: 'Curls', shape: 'curls' },
  long: { label: 'Long', shape: 'long' },
  ponytail: { label: 'Ponytail', shape: 'ponytail' },
  braids: { label: 'Braids', shape: 'braids' },
  bun: { label: 'Bun', shape: 'bun' },
  bald: { label: 'Bald', shape: 'bald' },
};

export const BUILDS = { slim: 'Slim', average: 'Average', broad: 'Broad' };

/**
 * Garments, by slot.
 *
 * `palette` is the colours that garment is offered in. A garment with no
 * palette is drawn in its own fixed colours (a football shirt is not a solid
 * block of whatever you fancy).
 */
export const WARDROBE = {
  top: {
    tee: { label: 'T-shirt', palette: true },
    longSleeve: { label: 'Long sleeve', palette: true },
    jersey: { label: 'Football shirt', palette: true, accent: true },
    hoodie: { label: 'Hoodie', palette: true },
    shirt: { label: 'Shirt', palette: true },
    dress: { label: 'Dress', palette: true, covers: 'bottom' },
    tank: { label: 'Vest', palette: true },
    jumper: { label: 'Jumper', palette: true },
  },
  bottom: {
    jeans: { label: 'Jeans', palette: true },
    cargo: { label: 'Cargo shorts', palette: true },
    shorts: { label: 'Shorts', palette: true },
    joggers: { label: 'Joggers', palette: true },
    skirt: { label: 'Skirt', palette: true },
    trousers: { label: 'Trousers', palette: true },
  },
  shoes: {
    sneakers: { label: 'Trainers', palette: true },
    slides: { label: 'Slides', palette: true },
    boots: { label: 'Boots', palette: true },
    barefoot: { label: 'Barefoot', palette: false },
  },
  accessory: {
    none: { label: 'None', palette: false },
    glasses: { label: 'Glasses', palette: false },
    earrings: { label: 'Earrings', palette: false },
    cap: { label: 'Cap', palette: true },
    beanie: { label: 'Beanie', palette: true },
    chain: { label: 'Chain', palette: false },
    headphones: { label: 'Headphones', palette: true },
  },
};

export const GARMENT_COLORS = {
  black: '#22212B', white: '#F4F2F0', grey: '#8A8A96', navy: '#2C3A63',
  blue: '#3F63C6', sky: '#6FB3E0', teal: '#2F9E8F', green: '#3F8F5B',
  olive: '#6B7350', mustard: '#D2A33C', orange: '#E07A3C', red: '#C8453F',
  pink: '#E36FA0', lilac: '#9B7FD4', cream: '#EDE0C8', brown: '#6B4A33',
};

export const DEFAULT_OUTFIT = {
  top: { id: 'tee', color: 'white' },
  bottom: { id: 'jeans', color: 'navy' },
  shoes: { id: 'sneakers', color: 'white' },
  accessory: { id: 'none' },
};

const SLOTS = Object.keys(WARDROBE);

/**
 * Normalises whatever a client sent into something drawable.
 *
 * Never throws and never returns a half-outfit: an unknown garment falls back
 * to the default for that slot rather than to nothing, because the failure
 * mode of "nothing" is a naked character.
 */
export function normalizeOutfit(input) {
  const out = {};
  for (const slot of SLOTS) {
    const fallback = DEFAULT_OUTFIT[slot];
    const chosen = input && typeof input === 'object' ? input[slot] : null;
    const id = chosen && WARDROBE[slot][chosen.id] ? chosen.id : fallback.id;
    const garment = WARDROBE[slot][id];

    out[slot] = { id };
    if (garment.palette) {
      out[slot].color = chosen && GARMENT_COLORS[chosen.color] ? chosen.color : (fallback.color || 'black');
    }
    if (garment.accent && chosen && GARMENT_COLORS[chosen.accent]) {
      out[slot].accent = chosen.accent;
    }
  }
  return out;
}

export function normalizeAvatar(input = {}) {
  return {
    skin: SKINS[input.skin] ? input.skin : 'medium',
    hair: HAIR_STYLES[input.hair] ? input.hair : 'short',
    hairColor: HAIR_COLORS[input.hairColor] ? input.hairColor : 'black',
    build: BUILDS[input.build] ? input.build : 'average',
    outfit: normalizeOutfit(input.outfit),
  };
}

/** The whole catalogue, for the wardrobe screen. */
export function catalogue() {
  return { SKINS, HAIR_COLORS, HAIR_STYLES, BUILDS, WARDROBE, GARMENT_COLORS, DEFAULT_OUTFIT };
}
