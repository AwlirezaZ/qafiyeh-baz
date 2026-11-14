// Creates the release signing key for the Android app (PKCS#12 keystore), without needing Java.
// Run it yourself:  npm run make-key
// It asks for a password in the terminal (never stored in the repo) and writes two files NEXT TO the
// project folder (not inside it, so they can never be committed):
//   ../qafiyeh-baz-release.p12          ← the keystore. BACK IT UP. Lose it = you can't update the app on Bazaar.
//   ../qafiyeh-baz-release.base64.txt   ← same file as base64, to paste into the GitHub secret ANDROID_KEYSTORE_BASE64
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import forge from "node-forge";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.dirname(root);
const p12Path = path.join(outDir, "qafiyeh-baz-release.p12");
const b64Path = path.join(outDir, "qafiyeh-baz-release.base64.txt");

if (fs.existsSync(p12Path)) {
  console.error(`A keystore already exists at ${p12Path} — not overwriting it.`);
  process.exit(1);
}

function ask(q, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); else rl.output.write("*"); };
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(a.trim()); });
  });
}

const name = (await ask("Your name or studio (shown in the certificate): ")) || "Qafiyeh-Baz";
const alias = (await ask("Key alias [qafiyehbaz]: ")) || "qafiyehbaz";
const pass = await ask("Choose a password (min 8 chars): ", true);
const pass2 = await ask("Repeat the password: ", true);
if (pass.length < 8 || pass !== pass2) { console.error("Passwords don't match or are shorter than 8 characters."); process.exit(1); }

console.log("Generating a 2048-bit RSA key (a few seconds)…");
const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = "01" + forge.util.bytesToHex(forge.random.getBytesSync(8));
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 30);   // stores want 25+ years
const attrs = [{ name: "commonName", value: name }, { name: "organizationName", value: "Qafiyeh-Baz" }];
cert.setSubject(attrs); cert.setIssuer(attrs);
cert.sign(keys.privateKey, forge.md.sha256.create());

const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], pass, { algorithm: "3des", friendlyName: alias });
const der = Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
fs.writeFileSync(p12Path, der);
fs.writeFileSync(b64Path, der.toString("base64"));

console.log(`
Done.
  Keystore: ${p12Path}
  Base64:   ${b64Path}

Now add these 4 secrets in GitHub → repo Settings → Secrets and variables → Actions → New repository secret:
  ANDROID_KEYSTORE_BASE64   = the whole content of ${path.basename(b64Path)}
  ANDROID_KEYSTORE_PASSWORD = the password you just chose
  ANDROID_KEY_ALIAS         = ${alias}
  ANDROID_KEY_PASSWORD      = the same password

Back up the .p12 file and the password somewhere safe (not in the repo). You need the SAME key for every update.
You can delete the .base64.txt file after adding the secret.
`);
