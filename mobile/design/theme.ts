// Canonical native visual tokens: quiet, atmospheric, and coach-first.
export const colors = {
  canvas: '#09090d',
  surface: '#17161d',
  surfaceRaised: '#201e28',
  surfaceAccent: '#172936',
  surfaceMuted: '#111116',
  surfaceSuccess: '#152522',
  border: '#2b2932',
  borderStrong: '#3a3743',
  borderSelected: '#5b9fc7',
  accent: '#a8daf2',
  accentStrong: '#78bfe5',
  accentSoft: '#d4effc',
  text: '#f7f5f2',
  textMuted: '#b8b4be',
  textSubtle: '#85818d',
  textFaint: '#625f69',
  input: '#f7f5f2',
  ink: '#111016',
  success: '#8fd3c0',
  successSurface: '#203b35',
  danger: '#ffb7af',
  dangerSurface: '#41282e',
  warningSurface: '#383126',
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
