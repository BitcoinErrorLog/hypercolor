// Polyfill crypto.getRandomValues so `uuid` works in the RN runtime. MUST be
// imported before anything that generates UUIDs (LinkService message ids).
import 'react-native-get-random-values';

// Polyfill Buffer for libraries that depend on it (PubkyService, Paykit codecs)
import { Buffer } from 'buffer';
global.Buffer = Buffer;

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
