// Canonical native visual tokens, derived from Isaiah's PR #22 onboarding flow.
export const colors = {
  canvas: '#07131f',
  surface: '#102330',
  surfaceRaised: '#122736',
  surfaceAccent: '#173344',
  surfaceMuted: '#0e202c',
  surfaceSuccess: '#112c32',
  border: '#203a4a',
  borderStrong: '#294151',
  borderSelected: '#ba824b',
  accent: '#e8b978',
  accentStrong: '#d59a5d',
  accentSoft: '#d29a5f',
  text: '#f5f0e8',
  textMuted: '#b8c4cb',
  textSubtle: '#8295a3',
  textFaint: '#617684',
  input: '#fff7e8',
  ink: '#101b25',
  success: '#7fb6a3',
  successSurface: '#24433f',
  danger: '#ffb4a8',
  dangerSurface: '#3b2529',
  warningSurface: '#3b3225',
  shadow: '#000000',
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
