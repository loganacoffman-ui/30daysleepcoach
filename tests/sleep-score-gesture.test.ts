import { describe, expect, it } from 'vitest';

import {
  clampSleepScore,
  dragIsHorizontal,
  scoreForTouch,
  trackLeftFromTouch,
} from '../mobile/today/sleepScoreGesture';

// A track 300px wide starting 40px from the left edge of the window.
const track = { left: 40, width: 300 };

describe('scoreForTouch', () => {
  it('maps the ends and middle of the track', () => {
    expect(scoreForTouch(track, 40)).toBe(0);
    expect(scoreForTouch(track, 190)).toBe(50);
    expect(scoreForTouch(track, 340)).toBe(100);
  });

  it('clamps a finger that travels past either end', () => {
    expect(scoreForTouch(track, -120)).toBe(0);
    expect(scoreForTouch(track, 900)).toBe(100);
  });

  it('scores nothing until the track has been laid out', () => {
    expect(scoreForTouch({ left: 0, width: 0 }, 190)).toBeNull();
  });

  it('reads the whole range rather than only its right half when the track is inset', () => {
    // Scoring against a left edge of 0 is what pinned inset tracks near 100:
    // every touch past the midpoint of the window read as the maximum.
    const scores = [40, 115, 190, 265, 340].map(pageX => scoreForTouch(track, pageX));
    expect(scores).toEqual([0, 25, 50, 75, 100]);
    expect(new Set(scores).size).toBe(scores.length);
  });
});

describe('trackLeftFromTouch', () => {
  it('recovers the left edge from a touch inside the track', () => {
    expect(trackLeftFromTouch({ locationX: 75, pageX: 115, width: 300 })).toBe(40);
  });

  it('recovers it for touches at either end', () => {
    expect(trackLeftFromTouch({ locationX: 0, pageX: 40, width: 300 })).toBe(40);
    expect(trackLeftFromTouch({ locationX: 300, pageX: 340, width: 300 })).toBe(40);
  });

  it('rejects an offset that cannot belong to this track', () => {
    expect(trackLeftFromTouch({ locationX: 480, pageX: 200, width: 300 })).toBeNull();
    expect(trackLeftFromTouch({ locationX: -8, pageX: 200, width: 300 })).toBeNull();
    expect(trackLeftFromTouch({ locationX: 75, pageX: 115, width: 0 })).toBeNull();
  });

  it('feeds scoreForTouch a geometry that scores the touch it came from', () => {
    const left = trackLeftFromTouch({ locationX: 225, pageX: 265, width: 300 });
    expect(left).not.toBeNull();
    expect(scoreForTouch({ left: left as number, width: 300 }, 265)).toBe(75);
  });
});

describe('dragIsHorizontal', () => {
  it('claims sideways drags for the slider', () => {
    expect(dragIsHorizontal({ x: 40, y: 6 })).toBe(true);
  });

  it('releases downward drags to the scroll view', () => {
    expect(dragIsHorizontal({ x: 6, y: 40 })).toBe(false);
  });

  it('releases a touch that has not moved, so a tap locks nothing', () => {
    expect(dragIsHorizontal({ x: 0, y: 0 })).toBe(false);
    expect(dragIsHorizontal(null)).toBe(false);
  });

  it('releases an ambiguous drag rather than holding the screen', () => {
    expect(dragIsHorizontal({ x: 12, y: 12 })).toBe(false);
  });
});

describe('clampSleepScore', () => {
  it('keeps scores whole and within range', () => {
    expect(clampSleepScore(72.6)).toBe(73);
    expect(clampSleepScore(-5)).toBe(0);
    expect(clampSleepScore(140)).toBe(100);
  });
});
