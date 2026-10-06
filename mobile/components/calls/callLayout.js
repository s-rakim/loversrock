// The call screen's fixed facts, apart from the screen so they can be tested
// on their own.

// How long a connected video call shows its controls before they slide away.
export const CONTROLS_HIDE_MS = 5000;

/** The window Android gives a call in picture in picture is this small. */
export const isPipSize = ({ width, height }) => width < 420 && height < 640 && width * height < 160000;

/** Where the sound can go, in words and icons, in the picker's order. */
export const AUDIO_ROUTES = [
  { id: 'EARPIECE', label: 'Phone', icon: 'phone-portrait-outline' },
  { id: 'SPEAKER_PHONE', label: 'Speaker', icon: 'volume-high-outline' },
  { id: 'BLUETOOTH', label: 'Bluetooth', icon: 'bluetooth' },
  { id: 'WIRED_HEADSET', label: 'Headphones', icon: 'headset-outline' },
];

/** The sound button's icon for where the sound is going now. */
export const routeIcon = (selected) => ({
  SPEAKER_PHONE: 'volume-high', BLUETOOTH: 'bluetooth', WIRED_HEADSET: 'headset',
}[selected] || 'volume-high');
