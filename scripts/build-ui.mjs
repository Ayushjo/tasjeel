// Packages the UI apps for the SAP HTML5 Application Repository: one zip per app with manifest.json and
// xs-app.json at the root. Run by `mbt build` (see mta.yaml) or directly: node scripts/build-ui.mjs <app>
//
// No UI5 tooling needed: the apps bootstrap UI5 from the CDN and load their own modules on demand.
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = {
  portal: { zip: 'tasjeelportal.zip' },
  // The vendors app reuses the portal's theme layer and icon font (served side by side locally, bundled here).
  vendors: { zip: 'tasjeelvendors.zip', shared: [['portal/webapp/css/style.css', 'css/style.css'], ['portal/webapp/fonts', 'fonts']] },
};

for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(APPS)) {
  const app = APPS[name];
  if (!app) throw new Error(`Unknown app "${name}"`);
  const src = join(root, 'app', name);
  const stage = join(src, 'dist', 'stage');
  rmSync(join(src, 'dist'), { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  cpSync(join(src, 'webapp'), stage, { recursive: true, filter: (f) => !f.includes('/less') });
  cpSync(join(src, 'xs-app.json'), join(stage, 'xs-app.json'));
  for (const [from, to] of app.shared || []) cpSync(join(root, 'app', from), join(stage, to), { recursive: true });
  for (const required of ['manifest.json', 'xs-app.json']) if (!existsSync(join(stage, required))) throw new Error(`${name}: ${required} missing`);

  execFileSync('zip', ['-qr', join('..', app.zip), '.'], { cwd: stage });
  rmSync(stage, { recursive: true, force: true });
  console.log(`${name} → app/${name}/dist/${app.zip}`);
}
