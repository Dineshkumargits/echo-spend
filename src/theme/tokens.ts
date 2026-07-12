/**
 * Echo Spend design tokens — "Money as Signal"
 *
 * Single source of truth for the visual system. ThemeProvider and
 * tailwind.config.js both derive from these values; never hardcode a hex
 * in a screen when a token exists.
 *
 * Concept: every transaction is a signal. Money out is a PULSE (warm amber —
 * energy spent, not a red failure state). Money in is an ECHO (cool aqua —
 * the signal returning). The aqua doubles as the AI/intelligence color.
 * Red is reserved for genuinely bad news (overbudget, destructive actions).
 */

// ─── Palette shape ───────────────────────────────────────────────────────────
// Every theme pack provides one of these per mode (dark + light). buildColors()
// maps the raw palette to the semantic keys the whole app consumes, so adding a
// new theme never touches a screen.

export interface Palette {
  // Grounds
  ink: string;         // app background
  tide: string;        // surface / cards
  tideRaised: string;  // elevated surface
  // Signals
  pulse: string;       // money out / primary action (accent)
  pulseSoft: string;
  echo: string;        // money in / AI / success
  echoSoft: string;
  alert: string;       // destructive / overbudget
  alertSoft: string;
  violet: string;      // split / shared-expense accent
  violetSoft: string;
  // Text & lines
  glow: string;        // primary text
  fog: string;         // secondary text
  fogFaint: string;    // muted text / disabled
  hairline: string;    // borders
  translucent: string; // faint fills
  // Contrast color for text/icons sitting ON the accent (pulse) fill
  onAccent: string;
}

// ─── Echo (default) — "Money as Signal" teal + amber ─────────────────────────

export const inkPalette: Palette = {
  // Grounds (teal-biased neutrals — never pure black/white)
  ink: '#0A1416',
  tide: '#101D21',
  tideRaised: '#15262B',
  // Signals
  pulse: '#FFB454',
  pulseSoft: 'rgba(255, 180, 84, 0.12)',
  echo: '#56D4C0',
  echoSoft: 'rgba(86, 212, 192, 0.12)',
  alert: '#FF6B5E',
  alertSoft: 'rgba(255, 107, 94, 0.12)',
  violet: '#BF5AF2',
  violetSoft: 'rgba(191, 90, 242, 0.12)',
  // Text
  glow: '#E8F2F0',
  fog: '#7E9895',
  fogFaint: '#3A4E4C',
  hairline: 'rgba(232, 242, 240, 0.09)',
  translucent: 'rgba(232, 242, 240, 0.05)',
  onAccent: '#0A1416',
};

export const dayPalette: Palette = {
  ink: '#F0F5F4',
  tide: '#FFFFFF',
  tideRaised: '#E7EEEC',
  pulse: '#B4761A',
  pulseSoft: 'rgba(180, 118, 26, 0.12)',
  echo: '#0C8271',
  echoSoft: 'rgba(12, 130, 113, 0.10)',
  alert: '#C2453B',
  alertSoft: 'rgba(194, 69, 59, 0.10)',
  violet: '#8B3FC4',
  violetSoft: 'rgba(139, 63, 196, 0.10)',
  glow: '#122120',
  fog: '#60716F',
  fogFaint: '#C7D4D2',
  hairline: 'rgba(18, 33, 32, 0.10)',
  translucent: 'rgba(18, 33, 32, 0.05)',
  onAccent: '#FFFFFF',
};

// ─── Midnight — deep indigo + cyan ───────────────────────────────────────────

const midnightDark: Palette = {
  ink: '#0B1020',
  tide: '#131A2E',
  tideRaised: '#1B2440',
  pulse: '#6C8CFF',
  pulseSoft: 'rgba(108, 140, 255, 0.14)',
  echo: '#3ED8E6',
  echoSoft: 'rgba(62, 216, 230, 0.12)',
  alert: '#FF6B8A',
  alertSoft: 'rgba(255, 107, 138, 0.12)',
  violet: '#B98CFF',
  violetSoft: 'rgba(185, 140, 255, 0.14)',
  glow: '#EAEEFF',
  fog: '#8B95BC',
  fogFaint: '#3A4266',
  hairline: 'rgba(234, 238, 255, 0.09)',
  translucent: 'rgba(234, 238, 255, 0.05)',
  onAccent: '#0B1020',
};

const midnightLight: Palette = {
  ink: '#F3F5FF',
  tide: '#FFFFFF',
  tideRaised: '#E9EDFF',
  pulse: '#3A5BD9',
  pulseSoft: 'rgba(58, 91, 217, 0.12)',
  echo: '#0E8A96',
  echoSoft: 'rgba(14, 138, 150, 0.10)',
  alert: '#C93A5E',
  alertSoft: 'rgba(201, 58, 94, 0.10)',
  violet: '#7B45C4',
  violetSoft: 'rgba(123, 69, 196, 0.10)',
  glow: '#141A2E',
  fog: '#5B6488',
  fogFaint: '#C3CAE6',
  hairline: 'rgba(20, 26, 46, 0.10)',
  translucent: 'rgba(20, 26, 46, 0.05)',
  onAccent: '#FFFFFF',
};

// ─── Rose — warm plum + rose ─────────────────────────────────────────────────

const roseDark: Palette = {
  ink: '#160A12',
  tide: '#21121C',
  tideRaised: '#2C1826',
  pulse: '#FF7EB0',
  pulseSoft: 'rgba(255, 126, 176, 0.14)',
  echo: '#F0B15E',
  echoSoft: 'rgba(240, 177, 94, 0.12)',
  alert: '#FF6B5E',
  alertSoft: 'rgba(255, 107, 94, 0.12)',
  violet: '#C58CFF',
  violetSoft: 'rgba(197, 140, 255, 0.14)',
  glow: '#F7E8F0',
  fog: '#B08699',
  fogFaint: '#553A48',
  hairline: 'rgba(247, 232, 240, 0.10)',
  translucent: 'rgba(247, 232, 240, 0.05)',
  onAccent: '#160A12',
};

const roseLight: Palette = {
  ink: '#FDF3F8',
  tide: '#FFFFFF',
  tideRaised: '#FBE7F0',
  pulse: '#C63878',
  pulseSoft: 'rgba(198, 56, 120, 0.12)',
  echo: '#B57314',
  echoSoft: 'rgba(181, 115, 20, 0.10)',
  alert: '#C2453B',
  alertSoft: 'rgba(194, 69, 59, 0.10)',
  violet: '#8B3FC4',
  violetSoft: 'rgba(139, 63, 196, 0.10)',
  glow: '#2A1220',
  fog: '#8B6577',
  fogFaint: '#E4C4D4',
  hairline: 'rgba(42, 18, 32, 0.10)',
  translucent: 'rgba(42, 18, 32, 0.05)',
  onAccent: '#FFFFFF',
};

// ─── Forest — deep green + lime ──────────────────────────────────────────────

const forestDark: Palette = {
  ink: '#0A140E',
  tide: '#0F1F16',
  tideRaised: '#152A1F',
  pulse: '#9BE564',
  pulseSoft: 'rgba(155, 229, 100, 0.14)',
  echo: '#5EC9A8',
  echoSoft: 'rgba(94, 201, 168, 0.12)',
  alert: '#FF7A5E',
  alertSoft: 'rgba(255, 122, 94, 0.12)',
  violet: '#C0A0FF',
  violetSoft: 'rgba(192, 160, 255, 0.14)',
  glow: '#E8F4EA',
  fog: '#7E9888',
  fogFaint: '#374E40',
  hairline: 'rgba(232, 244, 234, 0.09)',
  translucent: 'rgba(232, 244, 234, 0.05)',
  onAccent: '#0A140E',
};

const forestLight: Palette = {
  ink: '#F0F6F1',
  tide: '#FFFFFF',
  tideRaised: '#E4EEE6',
  pulse: '#3E7D1E',
  pulseSoft: 'rgba(62, 125, 30, 0.12)',
  echo: '#0C8267',
  echoSoft: 'rgba(12, 130, 103, 0.10)',
  alert: '#C24E3B',
  alertSoft: 'rgba(194, 78, 59, 0.10)',
  violet: '#6E45C4',
  violetSoft: 'rgba(110, 69, 196, 0.10)',
  glow: '#122117',
  fog: '#5C716A',
  fogFaint: '#C4D4C7',
  hairline: 'rgba(18, 33, 23, 0.10)',
  translucent: 'rgba(18, 33, 23, 0.05)',
  onAccent: '#FFFFFF',
};

// ─── Mono — neutral graphite + single blue accent ────────────────────────────

const monoDark: Palette = {
  ink: '#0D0D0F',
  tide: '#17171A',
  tideRaised: '#212125',
  pulse: '#E6E6E9',
  pulseSoft: 'rgba(230, 230, 233, 0.12)',
  echo: '#5B9DFF',
  echoSoft: 'rgba(91, 157, 255, 0.14)',
  alert: '#FF6B5E',
  alertSoft: 'rgba(255, 107, 94, 0.12)',
  violet: '#B18CFF',
  violetSoft: 'rgba(177, 140, 255, 0.14)',
  glow: '#F4F4F6',
  fog: '#8A8A92',
  fogFaint: '#3C3C42',
  hairline: 'rgba(244, 244, 246, 0.10)',
  translucent: 'rgba(244, 244, 246, 0.05)',
  onAccent: '#0D0D0F',
};

const monoLight: Palette = {
  ink: '#F4F4F6',
  tide: '#FFFFFF',
  tideRaised: '#EAEAED',
  pulse: '#26262B',
  pulseSoft: 'rgba(38, 38, 43, 0.10)',
  echo: '#2F6FE0',
  echoSoft: 'rgba(47, 111, 224, 0.10)',
  alert: '#C2453B',
  alertSoft: 'rgba(194, 69, 59, 0.10)',
  violet: '#6E45C4',
  violetSoft: 'rgba(110, 69, 196, 0.10)',
  glow: '#141416',
  fog: '#63636B',
  fogFaint: '#C8C8CE',
  hairline: 'rgba(20, 20, 22, 0.10)',
  translucent: 'rgba(20, 20, 22, 0.05)',
  onAccent: '#FFFFFF',
};

// ─── Solar — warm brown + amber/orange ───────────────────────────────────────

const solarDark: Palette = {
  ink: '#150F09',
  tide: '#211810',
  tideRaised: '#2C2117',
  pulse: '#FF9F45',
  pulseSoft: 'rgba(255, 159, 69, 0.14)',
  echo: '#F2C94C',
  echoSoft: 'rgba(242, 201, 76, 0.12)',
  alert: '#FF6B5E',
  alertSoft: 'rgba(255, 107, 94, 0.12)',
  violet: '#E08CFF',
  violetSoft: 'rgba(224, 140, 255, 0.14)',
  glow: '#F7ECDE',
  fog: '#B0997E',
  fogFaint: '#544738',
  hairline: 'rgba(247, 236, 222, 0.10)',
  translucent: 'rgba(247, 236, 222, 0.05)',
  onAccent: '#150F09',
};

const solarLight: Palette = {
  ink: '#FBF4EA',
  tide: '#FFFFFF',
  tideRaised: '#F4E8D6',
  pulse: '#C2681A',
  pulseSoft: 'rgba(194, 104, 26, 0.12)',
  echo: '#A67C0C',
  echoSoft: 'rgba(166, 124, 12, 0.10)',
  alert: '#C2453B',
  alertSoft: 'rgba(194, 69, 59, 0.10)',
  violet: '#9B45C4',
  violetSoft: 'rgba(155, 69, 196, 0.10)',
  glow: '#241810',
  fog: '#8B7660',
  fogFaint: '#E0CDB2',
  hairline: 'rgba(36, 24, 16, 0.10)',
  translucent: 'rgba(36, 24, 16, 0.05)',
  onAccent: '#FFFFFF',
};

// ─── Semantic theme colors ───────────────────────────────────────────────────
// Keeps the legacy keys (background/surface/primary/…) so every existing
// screen restyles automatically, plus the signal-semantic keys (debit/credit/
// ai/violet/onAccent…) that migrated screens consume.

export const buildColors = (p: Palette) => ({
  // Legacy keys — same names the whole app already consumes
  background: p.ink,
  surface: p.tide,
  surfaceElevated: p.tideRaised,
  primary: p.glow,
  secondary: p.fog,
  muted: p.fogFaint,
  accent: p.pulse,
  success: p.echo,
  warning: p.pulse,
  danger: p.alert,
  border: p.hairline,
  translucent: p.translucent,

  // Signal-semantic keys
  debit: p.pulse,          // money out — accent hue
  credit: p.echo,          // money in — echo hue
  ai: p.echo,              // on-device intelligence shares the echo hue
  violet: p.violet,        // split / shared-expense accent
  onAccent: p.onAccent,    // text/icons on an accent (pulse) fill
  debitSoft: p.pulseSoft,
  creditSoft: p.echoSoft,
  alertSoft: p.alertSoft,
  violetSoft: p.violetSoft,
});

// ─── Theme registry ──────────────────────────────────────────────────────────
// A curated pack = an identity (id/name/blurb) + tuned dark & light palettes +
// preview swatches for the picker. Add a pack here and it shows up everywhere.

export interface ThemeDefinition {
  id: string;
  name: string;
  blurb: string;
  dark: Palette;
  light: Palette;
}

export const THEMES: ThemeDefinition[] = [
  { id: 'echo',     name: 'Echo',     blurb: 'Signal teal & amber',  dark: inkPalette,   light: dayPalette },
  { id: 'midnight', name: 'Midnight', blurb: 'Indigo & cyan',        dark: midnightDark, light: midnightLight },
  { id: 'rose',     name: 'Rose',     blurb: 'Plum & rose',          dark: roseDark,     light: roseLight },
  { id: 'forest',   name: 'Forest',   blurb: 'Deep green & lime',    dark: forestDark,   light: forestLight },
  { id: 'mono',     name: 'Mono',     blurb: 'Graphite & blue',      dark: monoDark,     light: monoLight },
  { id: 'solar',    name: 'Solar',    blurb: 'Warm amber & gold',    dark: solarDark,    light: solarLight },
];

export const DEFAULT_THEME_ID = 'echo';

const THEME_BY_ID: Record<string, ThemeDefinition> = Object.fromEntries(
  THEMES.map((t) => [t.id, t])
);

/** Resolve a theme pack + light/dark mode to its raw palette. Falls back to Echo. */
export const getPalette = (themeId: string, mode: 'dark' | 'light'): Palette => {
  const theme = THEME_BY_ID[themeId] ?? THEME_BY_ID[DEFAULT_THEME_ID];
  return mode === 'dark' ? theme.dark : theme.light;
};

/** Small swatch set used by the theme picker cards. */
export const themeSwatches = (theme: ThemeDefinition, mode: 'dark' | 'light') => {
  const p = mode === 'dark' ? theme.dark : theme.light;
  return { bg: p.ink, surface: p.tide, accent: p.pulse, credit: p.echo, text: p.glow };
};

export const darkColors = buildColors(inkPalette);
export const lightColors = buildColors(dayPalette);
export type ThemeColors = ReturnType<typeof buildColors>;

/**
 * Append an 8-bit hex alpha to a 6-digit hex color, theme-safely.
 * e.g. withAlpha(colors.credit, '30') → the current theme's credit hue @ ~19%.
 * Falls back to the base color if it isn't a plain #RRGGBB (already-rgba tokens).
 */
export const withAlpha = (hex: string, alphaHex: string): string =>
  /^#[0-9A-Fa-f]{6}$/.test(hex) ? `${hex}${alphaHex}` : hex;

// ─── Typography ──────────────────────────────────────────────────────────────
// Loaded once in App.tsx via expo-font from assets/fonts/.
// display  → hero amounts & big headings (Clash Display)
// text     → everything readable (Switzer)
// signal   → raw SMS traces, hashes, timestamps, tabular data (JetBrains Mono)

export const fonts = {
  display: 'ClashDisplay-Semibold',
  displayBold: 'ClashDisplay-Bold',
  text: 'Switzer-Regular',
  textMedium: 'Switzer-Medium',
  textSemibold: 'Switzer-Semibold',
  textBold: 'Switzer-Bold',
  signal: 'JetBrainsMono-Regular',
  signalBold: 'JetBrainsMono-Bold',
};

export const fontFiles = {
  'ClashDisplay-Semibold': require('../../assets/fonts/ClashDisplay-Semibold.otf'),
  'ClashDisplay-Bold': require('../../assets/fonts/ClashDisplay-Bold.otf'),
  'Switzer-Regular': require('../../assets/fonts/Switzer-Regular.otf'),
  'Switzer-Medium': require('../../assets/fonts/Switzer-Medium.otf'),
  'Switzer-Semibold': require('../../assets/fonts/Switzer-Semibold.otf'),
  'Switzer-Bold': require('../../assets/fonts/Switzer-Bold.otf'),
  'JetBrainsMono-Regular': require('../../assets/fonts/JetBrainsMono-Regular.ttf'),
  'JetBrainsMono-Bold': require('../../assets/fonts/JetBrainsMono-Bold.ttf'),
};

export const typeScale = {
  hero: 40,        // dashboard safe-to-spend
  display: 32,     // screen-level amounts
  title: 22,       // screen titles
  heading: 17,     // card headings
  body: 15,
  caption: 12,
  label: 10,       // uppercase mono labels
};

// ─── Spacing / radius / motion ───────────────────────────────────────────────

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 };

export const motion = {
  // Rule 01 Emit / 02 Arrive / 03 Breathe / 04 Resonate
  fast: 160,
  base: 240,
  slow: 400,
  staggerStep: 40,     // list-arrival stagger per item
  pulsePeriod: 2200,   // heartbeat dot cycle
};

// ─── Formatting helpers (presentation only) ──────────────────────────────────

/** Indian-locale (lakh-aware) amount grouping: 124518 → "1,24,518" */
export const formatINR = (n: number, opts?: { decimals?: number }): string => {
  const decimals = opts?.decimals ?? (Number.isInteger(n) ? 0 : 2);
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
};
