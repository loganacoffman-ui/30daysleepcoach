import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = resolve(process.argv[2] || join(root, 'android/app/build/outputs/apk/release/app-release.apk'));
if (!existsSync(input)) throw new Error(`Build the release APK first: ${input}`);
const signingDir = join(root, '.android-signing');
mkdirSync(signingDir, { recursive: true, mode: 0o700 });
const credentialsPath = join(signingDir, 'preview.json');
const keystore = join(signingDir, 'preview.jks');
let credentials;
if (existsSync(credentialsPath)) credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
else {
  if (existsSync(keystore)) throw new Error('Signing key exists without its credentials. Restore preview.json before continuing.');
  credentials = { alias: 'sleepcoach-preview', password: randomBytes(32).toString('hex') };
  writeFileSync(credentialsPath, JSON.stringify(credentials), { mode: 0o600 });
}
const java = process.env.JAVA_HOME || '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
const sdk = process.env.ANDROID_HOME || join(process.env.HOME, 'Library/Android/sdk');
const env = { ...process.env, JAVA_HOME: java, SLEEP_COACH_KEY_PASSWORD: credentials.password };
if (!existsSync(keystore)) {
  execFileSync(join(java, 'bin/keytool'), ['-genkeypair', '-keystore', keystore, '-alias', credentials.alias,
    '-storepass:env', 'SLEEP_COACH_KEY_PASSWORD', '-keypass:env', 'SLEEP_COACH_KEY_PASSWORD',
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Sleep Coach Preview'], { env, stdio: 'pipe' });
  chmodSync(keystore, 0o600);
}
const output = join(root, 'dist/sleep-coach-preview.apk');
mkdirSync(dirname(output), { recursive: true });
const signer = join(sdk, 'build-tools/36.0.0/apksigner');
execFileSync(signer, ['sign', '--ks', keystore, '--ks-key-alias', credentials.alias,
  '--ks-pass', 'env:SLEEP_COACH_KEY_PASSWORD', '--key-pass', 'env:SLEEP_COACH_KEY_PASSWORD', '--out', output, input], { env, stdio: 'inherit' });
execFileSync(signer, ['verify', output], { env, stdio: 'inherit' });
console.log(`Signed APK: ${output}`);
console.log('Keep .android-signing/ backed up privately; updates must use the same key.');
