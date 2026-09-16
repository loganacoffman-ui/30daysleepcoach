// Geometry for the sleep score slider, kept apart from the control so the
// mapping from a finger position to a score can be exercised directly.

export type TrackGeometry = { left: number; width: number };

export type DragTravel = { x: number; y: number };

export const clampSleepScore = (score: number) =>
  Math.max(0, Math.min(100, Math.round(score)));

// The score a finger at `pageX` is pointing at. Null while the track has no
// width, which is the one case where a position cannot be scored — scoring it
// against a zero width is what used to snap the value to 0 or 100.
export const scoreForTouch = (geometry: TrackGeometry, pageX: number) =>
  geometry.width > 0 && Number.isFinite(pageX)
    ? clampSleepScore(((pageX - geometry.left) / geometry.width) * 100)
    : null;

// The track's left edge in window coordinates, recovered from a touch that
// landed on it: pageX is where the finger is, locationX where it is within the
// view it touched. Exact and available on the first event of a drag, unlike an
// asynchronous measurement. Null when locationX cannot be an offset within this
// track, which means the touch was reported against some other view.
export const trackLeftFromTouch = (
  { locationX, pageX, width }: { locationX: number; pageX: number; width: number },
) => (
  width > 0
    && Number.isFinite(locationX)
    && Number.isFinite(pageX)
    && locationX >= 0
    && locationX <= width
    ? pageX - locationX
    : null
);

// Which axis a drag has committed to. Sideways drags are the slider's own; the
// rest belong to the scroll view and the history swipe.
export const dragIsHorizontal = (travel: DragTravel | null) =>
  travel !== null && travel.x > travel.y;
