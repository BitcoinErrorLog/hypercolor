// Maestro GraalJS. Java.type is not available in Maestro 2.9; call the host
// bridge which writes HC_E2E:<url> into the Android sidecar.
const url = String(typeof E2E_URL === 'undefined' ? '' : E2E_URL).trim();
if (!url) {
  throw new Error('androidE2eCmd: E2E_URL is empty');
}
if (!url.toLowerCase().startsWith('hypercolor://e2e/')) {
  throw new Error('androidE2eCmd: E2E_URL must be a hypercolor://e2e/ link');
}

const appId =
  String(typeof APP_ID === 'undefined' ? '' : APP_ID).trim() || 'com.hypercolor';
const encoded =
  'http://127.0.0.1:18765/e2e?url=' + encodeURIComponent(url) + '&app=' + encodeURIComponent(appId);
const response = http.get(encoded);
const status = response.status || response.statusCode || 0;
const body = String(response.body || '');
if (status && status >= 400) {
  throw new Error('androidE2eCmd http ' + status + ': ' + body);
}
if (!status && body.indexOf('url must') !== -1) {
  throw new Error('androidE2eCmd: ' + body);
}
output.androidE2eCmd = body.trim();
