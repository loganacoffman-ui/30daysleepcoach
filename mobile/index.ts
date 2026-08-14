import { registerRootComponent } from 'expo';

import App from './App';
import TodayScreen from './today/TodayScreen';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
const RootComponent =
  process.env.EXPO_PUBLIC_APP_MODE === 'today-preview' ? TodayScreen : App;

registerRootComponent(RootComponent);
