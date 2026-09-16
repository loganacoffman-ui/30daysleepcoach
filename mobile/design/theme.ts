// Canonical native visual tokens: quiet, atmospheric, and coach-first.
export const colors = {
  canvas: '#F4EDDF',
  surface: '#FCF8F0',
  surfaceRaised: '#EAE2D5',
  surfaceAccent: '#F0DDD2',
  surfaceMuted: '#EFE7D9',
  surfaceSuccess: '#E5EBDD',
  border: '#DBD2C4',
  borderStrong: '#BDB3A5',
  borderSelected: '#B04E35',
  accent: '#B04E35',
  accentStrong: '#C0573C',
  accentSoft: '#98442F',
  text: '#16213A',
  textMuted: '#535A64',
  textSubtle: '#626875',
  textFaint: '#716B62',
  input: '#16213A',
  ink: '#FFF9F0',
  success: '#3D705B',
  successSurface: '#E2EBDD',
  danger: '#AC3832',
  dangerSurface: '#F5E0DA',
  warningSurface: '#F0E1C6',
  shadow: '#000000',
} as const;

export const layout = {
  screenTopPadding: 76,
  safeAreaHeaderPadding: 26,
} as const;

export const radii = {
  small: 12,
  control: 16,
  card: 20,
  feature: 24,
  pill: 999,
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 20,
  xl: 26,
  xxl: 34,
} as const;

export const type = {
  eyebrow: {
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 1.5,
  },
  title: {
    fontSize: 32,
    fontWeight: '800' as const,
    letterSpacing: -0.8,
    lineHeight: 38,
  },
  body: {
    fontSize: 15,
    lineHeight: 23,
  },
} as const;
