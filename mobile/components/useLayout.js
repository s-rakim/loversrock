// Phone or tablet, and how wide the content should be.
//
// On a tablet every screen used to stretch to the full width, a card or a
// line of text 1200 pixels across. Screens now sit in a column no wider than
// CONTENT_MAX, centred, over the app's full-width background; grids add
// columns instead of growing their tiles. Phones are untouched: a phone is
// narrower than the column.
import { useWindowDimensions } from 'react-native';

/** The widest a screen's content gets. */
export const CONTENT_MAX = 900;
/** Android's own line between a phone and a tablet: the shortest side, in dp. */
export const TABLET_MIN = 600;
/** The widest the floating tab bar gets. */
export const BAR_MAX = 640;

export const isTablet = ({ width, height }) => Math.min(width, height) >= TABLET_MIN;

/** The centred column for a screen at this window width, or null on a phone. */
export const contentColumn = (width) => (width > CONTENT_MAX + 48
  ? { width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' }
  : null);

/** How far in from each side the tab bar sits, so it is never wider than BAR_MAX. */
export const barInset = (width, min = 8) => Math.max(min, (width - BAR_MAX) / 2);

/** How many columns of at least `min` wide fit in the content's width. */
export const columnsFor = (width, min, gap = 0) => Math.max(1, Math.floor((Math.min(width, CONTENT_MAX) + gap) / (min + gap)));

export default function useLayout() {
  const window = useWindowDimensions();
  return {
    ...window,
    tablet: isTablet(window),
    landscape: window.width > window.height,
    contentWidth: Math.min(window.width, CONTENT_MAX),
  };
}
