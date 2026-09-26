// Layout the cycle screens share with the shell around them.
//
// The shell floats two things over its screens: the app's own tab bar along
// the bottom, and — for the person tracking — the round add button above it.
// Both float rather than taking layout space, so every scrolling cycle screen
// has to leave room for them itself. They each used to pad by a flat 32px,
// which put the last card underneath both.
import { useBarClearance } from '../LumaBar';
import { spacing } from '../../theme';

/** The add button's diameter; the shell draws it, the screens clear it. */
export const FAB_SIZE = 58;

/**
 * Bottom padding for a scrolling cycle screen, so its last row scrolls fully
 * clear of the add button and the main bar. Always leaves room for the
 * button: on the partner's side it is not drawn, and a little extra space at
 * the end of a list costs nothing.
 */
export function useCycleContentPadding() {
  const { above } = useBarClearance();
  return above + FAB_SIZE + spacing.md;
}
