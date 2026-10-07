import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Native Firebase configuration must be present before enabling Android push.
// This is baked into the binary, so a remote feature flag cannot enable it early.
export const remindersAvailable = () => Platform.OS === 'ios'
  || (Platform.OS === 'android' && Constants.expoConfig?.extra?.androidPushEnabled === true);
