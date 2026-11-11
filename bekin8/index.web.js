// Web entry: load Skia's CanvasKit (wasm) BEFORE the app evaluates, because every beacon shader is
// compiled at module scope. canvaskit.wasm is copied next to index.html by `npm run export-web`.
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { installWebAlert } from './lib/webAlert';

// react-native-web's Alert.alert does nothing; make every confirm in the app a real browser dialog.
installWebAlert();

// The app draws its own focus state on text fields; the browser's default outline doubled it up.
const style = document.createElement('style');
style.textContent = 'input:focus, textarea:focus { outline: none; }';
document.head.appendChild(style);

const base = process.env.EXPO_BASE_URL || '';
LoadSkiaWeb({ locateFile: (file) => `${base}/${file}` })
  .catch((e) => console.warn('Skia web failed to load', e))
  .then(() => {
    require('expo-router/entry');
  });
