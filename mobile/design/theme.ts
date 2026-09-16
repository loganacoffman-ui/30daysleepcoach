// Canonical native visual tokens: quiet, atmospheric, and coach-first.
export const colors = {
  canvas: '#16213A',
  surface: '#1D2B45',
  surfaceRaised: '#293852',
  surfaceAccent: '#293B50',
  surfaceMuted: '#121D32',
  surfaceSuccess: '#203A3A',
  border: '#36415A',
  borderStrong: '#56617A',
  borderSelected: '#7F9AAB',
  accent: '#B3CAD4',
  accentStrong: '#92B4C4',
  accentSoft: '#D0DFE3',
  text: '#F4EDDF',
  textMuted: '#C9C7C5',
  textSubtle: '#ACB2BD',
  textFaint: '#99A2B1',
  input: '#F4EDDF',
  ink: '#16213A',
  success: '#9BC8B0',
  successSurface: '#25423E',
  danger: '#F0ACA1',
  dangerSurface: '#49313D',
  warningSurface: '#443B36',
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
