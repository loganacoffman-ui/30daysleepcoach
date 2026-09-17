import { describe, expect, it } from 'vitest';
import { ChatScrollPosition } from '../mobile/coach/chatScroll';

const thread = () => {
  const position = new ChatScrollPosition();
  position.resize(600);
  position.contentChanged(1600);
  return position;
};

const readOlderMessage = (position: ChatScrollPosition, offset = 400) => {
  position.interacting = true;
  position.observeScroll(offset);
  position.interacting = false;
};

describe('chat reading position', () => {
  it('keeps the latest message above an opening keyboard and returns when it closes', () => {
    const position = thread();
    expect(position.resize(300)).toBe(1300);
    expect(position.resize(600)).toBe(1000);
    expect(position.following).toBe(true);
  });

  it('lifts the older message being read without jumping to the latest message', () => {
    const position = thread();
    readOlderMessage(position);
    const visibleBottom = position.offset + position.viewportHeight;
    expect(position.resize(300)).toBe(700);
    expect(position.offset + position.viewportHeight).toBe(visibleBottom);
    expect(position.following).toBe(false);
    expect(position.resize(600)).toBe(400);
  });

  it('retries the full bottom offset after the keyboard animation clamps the first scroll', () => {
    const position = thread();
    expect(position.resize(300)).toBe(1300);
    // The native viewport is still animating and can only scroll partway yet.
    position.observeScroll(1080);
    expect(position.settleLayout()).toBe(1300);
    expect(position.offset + position.viewportHeight).toBe(position.contentHeight);
  });

  it('retains an older reading anchor through intermediate native clamps', () => {
    const position = thread();
    readOlderMessage(position);
    expect(position.resize(450)).toBe(550);
    position.observeScroll(430);
    expect(position.resize(300)).toBe(700);
    position.observeScroll(500);
    expect(position.settleLayout()).toBe(700);
    expect(position.following).toBe(false);
    expect(position.resize(600)).toBe(400);
  });

  it('does not restore a keyboard anchor after the reader deliberately scrolls elsewhere', () => {
    const position = thread();
    position.resize(300);
    readOlderMessage(position, 500);
    expect(position.settleLayout()).toBeNull();
    expect(position.offset).toBe(500);
  });

  it('does not retry a keyboard scroll during a drag', () => {
    const position = thread();
    position.resize(300);
    position.interacting = true;
    expect(position.settleLayout()).toBeNull();
  });

  it('also preserves the reading position as a multiline composer grows', () => {
    const position = thread();
    readOlderMessage(position);
    expect(position.resize(556)).toBe(444);
    expect(position.resize(600)).toBe(400);
  });

  it('reveals a sent message after its bubble is measured, even when previously reading history', () => {
    const position = thread();
    readOlderMessage(position);
    expect(position.latest()).toBe(1000);
    expect(position.contentChanged(1760)).toBe(1160);
    // A native event from the earlier programmatic animation cannot turn off following.
    position.observeScroll(600);
    expect(position.contentChanged(1800)).toBe(1200);
  });

  it('follows a growing reply only while the reader remains at the bottom', () => {
    const position = thread();
    expect(position.contentChanged(1644)).toBe(1044);
    readOlderMessage(position);
    expect(position.contentChanged(1800)).toBeNull();
    expect(position.offset).toBe(400);
    readOlderMessage(position, 1190);
    expect(position.contentChanged(1844)).toBe(1244);
  });

  it('does not fight an active drag or fling', () => {
    const position = thread();
    position.interacting = true;
    position.observeScroll(990);
    expect(position.contentChanged(1700)).toBeNull();
    expect(position.resize(500)).toBeNull();
    expect(position.offset).toBe(990);
  });

  it('ignores hidden-pane layout and handles short or empty conversations', () => {
    const position = thread();
    readOlderMessage(position);
    expect(position.resize(0)).toBeNull();
    expect(position.viewportHeight).toBe(600);
    expect(position.resize(600)).toBeNull();
    position.contentChanged(100);
    expect(position.latest()).toBe(0);
    expect(position.resize(300)).toBe(0);
    expect(position.contentChanged(0)).toBe(0);
  });

  it('opens Your Day at the sleep review instead of skipping to its footer', () => {
    const position = new ChatScrollPosition(false);
    expect(position.contentChanged(1600)).toBeNull();
    expect(position.resize(600)).toBeNull();
    expect(position.offset).toBe(0);
    expect(position.latest()).toBe(1000);
    expect(position.contentChanged(1700)).toBe(1100);
  });
});
