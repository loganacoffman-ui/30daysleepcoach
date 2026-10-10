const NEAR_LATEST_DISTANCE = 80;

// Shared by the virtualized Coach thread and the daily check-in's ScrollView.
// Only user scrolling changes follow mode; keyboard/layout events must not.
export class ChatScrollPosition {
  contentHeight = 0;
  viewportHeight = 0;
  offset = 0;
  interacting = false;
  latestOffset: number | null = null;
  private layoutTarget: number | null = null;

  constructor(public following = true) {}

  get end() {
    return Math.max(0, this.contentHeight - this.viewportHeight);
  }

  get latestTarget() {
    return Math.min(this.end, Math.max(0, this.latestOffset ?? this.end));
  }

  setLatestOffset(offset: number | null): number | null {
    this.latestOffset = offset;
    return this.following && !this.interacting && this.viewportHeight > 0
      ? this.moveTo(this.latestTarget)
      : null;
  }

  observeScroll(offset: number) {
    this.offset = Math.max(0, offset);
    if (this.interacting) {
      this.layoutTarget = null;
      this.following = this.latestOffset === null
        ? this.end - this.offset <= NEAR_LATEST_DISTANCE
        : Math.abs(this.latestTarget - this.offset) <= NEAR_LATEST_DISTANCE;
    }
  }

  resize(height: number): number | null {
    // Mounted, hidden panes report zero. Retain their reading position.
    if (height <= 0) return null;
    const previousHeight = this.viewportHeight;
    this.viewportHeight = height;
    if (this.interacting) return null;
    if (this.following) return this.moveTo(this.latestTarget);
    if (!previousHeight || previousHeight === height) return null;
    // Anchor the bottom of the visible conversation as the keyboard or a
    // multiline composer changes height, even when reading an older message.
    return this.moveTo((this.layoutTarget ?? this.offset) + previousHeight - height);
  }

  contentChanged(height: number): number | null {
    this.contentHeight = height;
    return this.following && !this.interacting && this.viewportHeight > 0
      ? this.moveTo(this.latestTarget)
      : null;
  }

  latest(): number {
    this.following = true;
    this.interacting = false;
    return this.moveTo(this.latestTarget);
  }

  settleLayout(): number | null {
    if (this.interacting || !this.viewportHeight) return null;
    // Native scroll events during a keyboard animation may report a clamped
    // offset against the old viewport. Retry the intended position once the
    // animation completes, without treating that clamp as a new reading anchor.
    if (this.following) return this.moveTo(this.latestTarget);
    return this.layoutTarget === null ? null : this.moveTo(this.layoutTarget);
  }

  private moveTo(offset: number) {
    this.offset = Math.min(this.end, Math.max(0, offset));
    this.layoutTarget = this.offset;
    return this.offset;
  }
}
