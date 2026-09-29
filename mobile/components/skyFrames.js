// Made by scripts/build-sky.py: do not edit by hand, run it again.
//
// SKY_FRAMES are the pictures of the day, each its own mix of lights:
// the sky, and each scene's foreground under it.
// SKY_TIMELINE is [hour, picture, stars] through the day: between two
// rows the sky blends from one picture to the next.
/* eslint-disable global-require */
export const SKY_FRAMES = [
  {
    sky: require('../assets/sky/00-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/00.webp'), newyork: require('../assets/sky/newyork/00.webp') },
    mix: { moon: 1 },
  },
  {
    sky: require('../assets/sky/01-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/01.webp'), newyork: require('../assets/sky/newyork/01.webp') },
    mix: { night: 0.259, moon: 0.741 },
  },
  {
    sky: require('../assets/sky/02-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/02.webp'), newyork: require('../assets/sky/newyork/02.webp') },
    mix: { night: 0.741, moon: 0.259 },
  },
  {
    sky: require('../assets/sky/03-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/03.webp'), newyork: require('../assets/sky/newyork/03.webp') },
    mix: { night: 1 },
  },
  {
    sky: require('../assets/sky/04-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/04.webp'), newyork: require('../assets/sky/newyork/04.webp') },
    mix: { twilight: 0.225, night: 0.775 },
  },
  {
    sky: require('../assets/sky/05-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/05.webp'), newyork: require('../assets/sky/newyork/05.webp') },
    mix: { twilight: 0.45, night: 0.55 },
  },
  {
    sky: require('../assets/sky/06-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/06.webp'), newyork: require('../assets/sky/newyork/06.webp') },
    mix: { dawn: 0.25, twilight: 0.475, night: 0.275 },
  },
  {
    sky: require('../assets/sky/07-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/07.webp'), newyork: require('../assets/sky/newyork/07.webp') },
    mix: { dawn: 0.5, twilight: 0.5 },
  },
  {
    sky: require('../assets/sky/08-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/08.webp'), newyork: require('../assets/sky/newyork/08.webp') },
    mix: { dawn: 0.75, twilight: 0.25 },
  },
  {
    sky: require('../assets/sky/09-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/09.webp'), newyork: require('../assets/sky/newyork/09.webp') },
    mix: { dawn: 1 },
  },
  {
    sky: require('../assets/sky/10-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/10.webp'), newyork: require('../assets/sky/newyork/10.webp') },
    mix: { dawn: 0.875, day: 0.125 },
  },
  {
    sky: require('../assets/sky/11-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/11.webp'), newyork: require('../assets/sky/newyork/11.webp') },
    mix: { dawn: 0.75, day: 0.25 },
  },
  {
    sky: require('../assets/sky/12-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/12.webp'), newyork: require('../assets/sky/newyork/12.webp') },
    mix: { dawn: 0.633, day: 0.367 },
  },
  {
    sky: require('../assets/sky/13-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/13.webp'), newyork: require('../assets/sky/newyork/13.webp') },
    mix: { dawn: 0.417, day: 0.583 },
  },
  {
    sky: require('../assets/sky/14-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/14.webp'), newyork: require('../assets/sky/newyork/14.webp') },
    mix: { dawn: 0.3, day: 0.7 },
  },
  {
    sky: require('../assets/sky/15-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/15.webp'), newyork: require('../assets/sky/newyork/15.webp') },
    mix: { dawn: 0.15, day: 0.85 },
  },
  {
    sky: require('../assets/sky/16-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/16.webp'), newyork: require('../assets/sky/newyork/16.webp') },
    mix: { day: 1 },
  },
  {
    sky: require('../assets/sky/17-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/17.webp'), newyork: require('../assets/sky/newyork/17.webp') },
    mix: { day: 0.875, sunset: 0.125 },
  },
  {
    sky: require('../assets/sky/18-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/18.webp'), newyork: require('../assets/sky/newyork/18.webp') },
    mix: { day: 0.75, sunset: 0.25 },
  },
  {
    sky: require('../assets/sky/19-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/19.webp'), newyork: require('../assets/sky/newyork/19.webp') },
    mix: { day: 0.575, sunset: 0.425 },
  },
  {
    sky: require('../assets/sky/20-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/20.webp'), newyork: require('../assets/sky/newyork/20.webp') },
    mix: { day: 0.4, sunset: 0.6 },
  },
  {
    sky: require('../assets/sky/21-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/21.webp'), newyork: require('../assets/sky/newyork/21.webp') },
    mix: { day: 0.2, sunset: 0.8 },
  },
  {
    sky: require('../assets/sky/22-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/22.webp'), newyork: require('../assets/sky/newyork/22.webp') },
    mix: { sunset: 1 },
  },
  {
    sky: require('../assets/sky/23-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/23.webp'), newyork: require('../assets/sky/newyork/23.webp') },
    mix: { sunset: 0.725, twilight: 0.275 },
  },
  {
    sky: require('../assets/sky/24-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/24.webp'), newyork: require('../assets/sky/newyork/24.webp') },
    mix: { sunset: 0.45, twilight: 0.55 },
  },
  {
    sky: require('../assets/sky/25-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/25.webp'), newyork: require('../assets/sky/newyork/25.webp') },
    mix: { sunset: 0.225, twilight: 0.65, night: 0.125 },
  },
  {
    sky: require('../assets/sky/26-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/26.webp'), newyork: require('../assets/sky/newyork/26.webp') },
    mix: { twilight: 0.75, night: 0.25 },
  },
  {
    sky: require('../assets/sky/27-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/27.webp'), newyork: require('../assets/sky/newyork/27.webp') },
    mix: { twilight: 0.525, night: 0.475 },
  },
  {
    sky: require('../assets/sky/28-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/28.webp'), newyork: require('../assets/sky/newyork/28.webp') },
    mix: { twilight: 0.3, night: 0.7 },
  },
  {
    sky: require('../assets/sky/29-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/29.webp'), newyork: require('../assets/sky/newyork/29.webp') },
    mix: { twilight: 0.15, night: 0.85 },
  },
  {
    sky: require('../assets/sky/30-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/30.webp'), newyork: require('../assets/sky/newyork/30.webp') },
    mix: { night: 0.844, moon: 0.156 },
  },
  {
    sky: require('../assets/sky/31-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/31.webp'), newyork: require('../assets/sky/newyork/31.webp') },
    mix: { night: 0.5, moon: 0.5 },
  },
  {
    sky: require('../assets/sky/32-sky.jpg'),
    ground: { goldengate: require('../assets/sky/goldengate/32.webp'), newyork: require('../assets/sky/newyork/32.webp') },
    mix: { night: 0.156, moon: 0.844 },
  },
];

export const SKY_TIMELINE = [
  [0, 0, 0.8],
  [3.6667, 0, 0.8],
  [4, 1, 0.852],
  [4.3333, 2, 0.948],
  [4.6667, 3, 1],
  [5, 4, 0.85],
  [5.3333, 5, 0.7],
  [5.6667, 6, 0.5],
  [6, 7, 0.3],
  [6.3333, 8, 0.15],
  [6.6667, 9, 0],
  [7, 10, 0],
  [7.3333, 11, 0],
  [7.6667, 12, 0],
  [8, 13, 0],
  [8.3333, 14, 0],
  [8.6667, 15, 0],
  [9, 16, 0],
  [16, 16, 0],
  [16.3333, 17, 0],
  [16.6667, 18, 0],
  [17, 19, 0],
  [17.3333, 20, 0],
  [17.6667, 21, 0],
  [18, 22, 0],
  [18.3333, 22, 0.025],
  [18.6667, 22, 0.05],
  [19, 23, 0.1],
  [19.3333, 24, 0.15],
  [19.6667, 25, 0.3],
  [20, 26, 0.45],
  [20.3333, 27, 0.625],
  [20.6667, 28, 0.8],
  [21, 29, 0.9],
  [21.3333, 3, 1],
  [22.6667, 3, 1],
  [23, 30, 0.969],
  [23.3333, 31, 0.9],
  [23.6667, 32, 0.831],
  [24, 0, 0.8],
];
