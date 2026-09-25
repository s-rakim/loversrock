// Wardrobe catalogue for the couple's characters. An avatar is plain JSON so
// it can be stored on the server and drawn on either partner's phone:
//
// { skin, hair: { style, color }, top: { style, color }, bottom: { style, color },
//   shoes: { style, color }, socks, accessories: [...] }

export const SKIN_TONES = ['#F6D5C0', '#E8B795', '#C98E68', '#A86B45', '#8A5534', '#6E4128', '#57331F', '#3F2416'];

export const HAIR_STYLES = [
  { key: 'puff', label: 'High puff' },
  { key: 'twists', label: 'Twists' },
  { key: 'afro', label: 'Afro' },
  { key: 'braids', label: 'Braids' },
  { key: 'bun', label: 'Bun' },
  { key: 'long', label: 'Long' },
  { key: 'short', label: 'Short' },
  { key: 'buzz', label: 'Buzz cut' },
];
export const HAIR_COLORS = ['#1B120D', '#2A1A12', '#4A2E1E', '#6B4226', '#A0522D', '#C9A66B', '#E7D3A8', '#8E8E8E', '#C2185B', '#5E35B1'];

export const TOP_STYLES = [
  { key: 'fitted_long', label: 'Fitted long-sleeve' },
  { key: 'jersey', label: 'Football jersey' },
  { key: 'tee', label: 'T-shirt' },
  { key: 'hoodie', label: 'Hoodie' },
  { key: 'tank', label: 'Tank top' },
  { key: 'shirt', label: 'Button shirt' },
  { key: 'dress', label: 'Dress' },
];
export const BOTTOM_STYLES = [
  { key: 'jeans', label: 'Jeans' },
  { key: 'cargo_shorts', label: 'Cargo shorts' },
  { key: 'shorts', label: 'Shorts' },
  { key: 'joggers', label: 'Joggers' },
  { key: 'skirt', label: 'Skirt' },
];
export const SHOE_STYLES = [
  { key: 'sneakers', label: 'Sneakers' },
  { key: 'slides', label: 'Slides' },
  { key: 'boots', label: 'Boots' },
  { key: 'heels', label: 'Heels' },
  { key: 'barefoot', label: 'Barefoot' },
];
export const CLOTH_COLORS = [
  '#2F5D4E', '#2B3F8C', '#3B5A85', '#1F2A44', '#8A8660', '#C8B89A', '#FFFFFF', '#222222',
  '#E8607A', '#C62828', '#F9A825', '#7B1FA2', '#00897B', '#FF8A65', '#90A4AE', '#3FB8AF',
];
export const ACCESSORIES = [
  { key: 'hoops', label: 'Gold hoops' },
  { key: 'studs', label: 'Studs' },
  { key: 'necklace', label: 'Necklace' },
  { key: 'glasses', label: 'Glasses' },
  { key: 'sunglasses', label: 'Sunglasses' },
  { key: 'cap', label: 'Cap' },
  { key: 'beanie', label: 'Beanie' },
  { key: 'flower', label: 'Flower' },
  { key: 'watch', label: 'Watch' },
  { key: 'microphone', label: 'Microphone' },
];

// The two starting looks, drawn from the couple's photo.
export const PRESETS = {
  her: {
    preset: 'her',
    skin: '#6E4128',
    hair: { style: 'puff', color: '#2A1A12' },
    top: { style: 'fitted_long', color: '#2F5D4E' },
    bottom: { style: 'jeans', color: '#3B5A85' },
    shoes: { style: 'sneakers', color: '#222222' },
    socks: false,
    accessories: ['hoops'],
  },
  him: {
    preset: 'him',
    skin: '#8A5534',
    hair: { style: 'twists', color: '#1B120D' },
    top: { style: 'jersey', color: '#2B3F8C' },
    bottom: { style: 'cargo_shorts', color: '#8A8660' },
    shoes: { style: 'slides', color: '#3FB8AF' },
    socks: true,
    accessories: ['microphone'],
  },
};

export const DEFAULT_AVATAR = PRESETS.him;

/** Fills any missing pieces so an older/partial avatar always renders. */
export function normalizeAvatar(avatar) {
  const base = PRESETS[avatar?.preset] || DEFAULT_AVATAR;
  if (!avatar || typeof avatar !== 'object') return base;
  return {
    ...base,
    ...avatar,
    hair: { ...base.hair, ...(avatar.hair || {}) },
    top: { ...base.top, ...(avatar.top || {}) },
    bottom: { ...base.bottom, ...(avatar.bottom || {}) },
    shoes: { ...base.shoes, ...(avatar.shoes || {}) },
    accessories: Array.isArray(avatar.accessories) ? avatar.accessories : base.accessories,
  };
}
