// Lanza la herramienta de Firebase para los emuladores (pruebas locales,
// nunca la base real), con los ajustes que hacen falta en Windows:
//
//   node scripts/emuladores.mjs emulators:start --only auth,firestore --project demo-gemb
//
//  1. Si la carpeta temporal tiene espacios ("C:\Users\Juan Sebastian\…"), el
//     emulador de Firestore (Java) no logra abrir su conexión interna
//     ("Unable to establish loopback connection"). Se le da otra sin espacios.
//     Se hace siempre en Windows: Node muestra la carpeta con el nombre corto
//     (JUANSE~1, sin espacio), pero Java usa el largo.
//  2. Si Java está instalado pero no en el PATH, se busca en las carpetas
//     habituales.
//  3. El atajo `firebase.cmd` se rompe con espacios en la ruta del usuario:
//     se llama directo al programa con Node.
//
// En Mac/Linux, o si nada de eso aplica, es lo mismo que llamar a `firebase`.

import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const env = { ...process.env };
const clavePath = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';

if (process.platform === 'win32') {
  if (!env.JAVA_TOOL_OPTIONS) {
    const tmp = 'C:\\Users\\Public\\jtmp';
    mkdirSync(tmp, { recursive: true });
    env.JAVA_TOOL_OPTIONS = `-Djdk.net.unixdomain.tmpdir=${tmp} -Djava.io.tmpdir=${tmp}`;
  }
  try {
    execSync('java -version', { stdio: 'ignore', env });
  } catch {
    const bases = ['Microsoft', 'Eclipse Adoptium', 'Java', 'Zulu'].map((d) =>
      path.join('C:\\Program Files', d),
    );
    for (const base of bases) {
      if (!existsSync(base)) continue;
      const jdk = readdirSync(base)
        .filter((d) => /^(jdk|zulu)/i.test(d))
        .sort()
        .pop();
      if (jdk) {
        env[clavePath] = `${path.join(base, jdk, 'bin')};${env[clavePath] ?? ''}`;
        break;
      }
    }
  }
}

let firebaseJs = '';
try {
  const raiz = execSync('npm root -g', { encoding: 'utf8' }).trim();
  const candidato = path.join(raiz, 'firebase-tools', 'lib', 'bin', 'firebase.js');
  if (existsSync(candidato)) firebaseJs = candidato;
} catch {
  /* sin npm global: se intenta con `firebase` del PATH */
}

const args = process.argv.slice(2);
const hijo = firebaseJs
  ? spawn(process.execPath, [firebaseJs, ...args], { stdio: 'inherit', env })
  : spawn('firebase', args, { stdio: 'inherit', env, shell: true });
hijo.on('exit', (codigo) => process.exit(codigo ?? 1));
