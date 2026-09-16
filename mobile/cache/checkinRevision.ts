// Progress and the sleep profile are built from check-ins, so saving one has to
// reach a tab the user is not looking at. Screens read the revision they last
// rendered and refresh when it moves, which is the "dirty after check-in" signal
// the throttled tab refresh cannot provide on its own.
let revision = 0;
const listeners = new Set<() => void>();

export const checkinRevision = () => revision;

export const markCheckinSaved = () => {
  revision += 1;
  listeners.forEach(listener => listener());
};

export const subscribeToCheckins = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
