import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { ChatScrollPosition } from './chatScroll';

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

type ChatScrollOptions = {
  scrollTo: (offset: number, animated: boolean) => void;
  scrollToEnd: (animated: boolean) => void;
  initiallyFollowing?: boolean;
};

export function useChatScroll({ scrollTo, scrollToEnd, initiallyFollowing = true }: ChatScrollOptions) {
  const position = useRef(new ChatScrollPosition(initiallyFollowing));
  const scroll = useRef({ scrollTo, scrollToEnd });
  scroll.current = { scrollTo, scrollToEnd };
  const visible = useRef(false);
  const frame = useRef<number | null>(null);
  const userGesture = useRef(false);
  const [showLatest, setShowLatest] = useState(false);

  const cancelScroll = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  useEffect(() => cancelScroll, [cancelScroll]);

  const scheduleScroll = useCallback((offset: number | null, animated = false, nativeEnd = position.current.following) => {
    if (offset === null) return;
    cancelScroll();
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      userGesture.current = false;
      if (nativeEnd) scroll.current.scrollToEnd(animated);
      else scroll.current.scrollTo(offset, animated);
    });
  }, [cancelScroll]);

  useEffect(() => {
    const settleKeyboard = () => {
      if (!visible.current) return;
      scheduleScroll(position.current.settleLayout(), false, position.current.following);
    };
    // onLayout can precede the native keyboard/layout animation. Scrolling only
    // then can be clamped to the old scroll range, leaving the last paragraph
    // behind the composer. Reconcile after completion using the native end,
    // which also accounts for the scroll view's actual bounds and insets.
    const subscriptions = [
      Keyboard.addListener('keyboardDidShow', settleKeyboard),
      Keyboard.addListener('keyboardDidHide', settleKeyboard),
      Keyboard.addListener('keyboardDidChangeFrame', settleKeyboard),
    ];
    return () => subscriptions.forEach(subscription => subscription.remove());
  }, [scheduleScroll]);

  const scrollToLatest = useCallback(() => {
    setShowLatest(false);
    scheduleScroll(position.current.latest(), true);
    // Follow mode also handles the subsequent content-size event, after the
    // newly sent bubble has actually been measured.
  }, [scheduleScroll]);

  const reset = useCallback(() => {
    cancelScroll();
    userGesture.current = false;
    position.current = new ChatScrollPosition(initiallyFollowing);
    setShowLatest(false);
  }, [cancelScroll, initiallyFollowing]);

  const onScroll = useCallback(({ nativeEvent }: ScrollEvent) => {
    position.current.observeScroll(nativeEvent.contentOffset.y);
    if (position.current.interacting) setShowLatest(!position.current.following);
  }, []);

  const beginInteraction = useCallback(() => {
    cancelScroll();
    userGesture.current = true;
    position.current.interacting = true;
  }, [cancelScroll]);

  const endInteraction = useCallback((event: ScrollEvent) => {
    onScroll(event);
    position.current.interacting = false;
  }, [onScroll]);

  return {
    reset,
    scrollToLatest,
    showLatest,
    scrollProps: {
      onLayout: ({ nativeEvent }: LayoutChangeEvent) => {
        visible.current = nativeEvent.layout.height > 0;
        scheduleScroll(position.current.resize(nativeEvent.layout.height));
      },
      onContentSizeChange: (_width: number, height: number) => scheduleScroll(position.current.contentChanged(height)),
      onScroll,
      onScrollBeginDrag: beginInteraction,
      onScrollEndDrag: endInteraction,
      // Animated scrollTo also emits momentum events on iOS. Only a real drag
      // may pause following; our own animation must not look like reading up.
      onMomentumScrollBegin: () => {
        if (userGesture.current) beginInteraction();
      },
      onMomentumScrollEnd: (event: ScrollEvent) => {
        if (userGesture.current) endInteraction(event);
        userGesture.current = false;
      },
      scrollEventThrottle: 16,
    },
  };
}
