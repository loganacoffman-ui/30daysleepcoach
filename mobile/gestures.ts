// A sideways drag means two things on the Daily coaching screen: setting the
// sleep score on the slider, and pulling the history drawer open. The responder
// system can only tell them apart once the drag has a direction, but a
// screen-level swipe handler capturing the touch is asked for that verdict
// before the control it sits above has been given the move — so mid-drag
// arbitration always resolves in the swipe handler's favour.
//
// Ownership is claimed at touch-start instead. A control that reads horizontal
// drags claims the touch, and screen-level swipe handlers stand down until it is
// released. A device has one active touch, so a single claim covers it.

let claimed = false;

export const claimHorizontalDrag = () => {
  claimed = true;
};

export const releaseHorizontalDrag = () => {
  claimed = false;
};

export const horizontalDragClaimed = () => claimed;
