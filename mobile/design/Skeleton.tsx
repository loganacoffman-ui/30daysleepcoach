import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type DimensionValue, type ViewStyle } from 'react-native';

import { colors } from './theme';

// Placeholders keep a screen's real layout on the first ever load, so the page
// arrives already shaped instead of as a centred spinner.
export function Skeleton({ height = 14, radius = 8, style, width = '100%' }: {
  height?: number;
  radius?: number;
  style?: ViewStyle;
  width?: DimensionValue;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { duration: 620, easing: Easing.inOut(Easing.quad), toValue: 1, useNativeDriver: true }),
        Animated.timing(pulse, { duration: 620, easing: Easing.inOut(Easing.quad), toValue: 0, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        styles.block,
        { borderRadius: radius, height, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.34, 0.68] }), width },
        style,
      ]}
    />
  );
}

export function SkeletonLines({ count = 3, gap = 9, lastLineWidth = '62%' }: {
  count?: number;
  gap?: number;
  lastLineWidth?: DimensionValue;
}) {
  return (
    <View style={{ gap }}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton height={13} key={index} width={index === count - 1 ? lastLineWidth : '100%'} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.surfaceRaised },
});
