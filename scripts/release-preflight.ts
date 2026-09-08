import packageJson from '../package.json';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tag = process.env.GITHUB_REF_TYPE === 'tag'
  ? process.env.GITHUB_REF_NAME
  : undefined;

if (packageJson.name !== '@forgeax/app-shell') {
  throw new Error(`Unexpected package name: ${packageJson.name}`);
}
if (packageJson.publishConfig?.access !== 'public') {
  throw new Error('publishConfig.access must be public');
}
if ('private' in packageJson && packageJson.private === true) {
  throw new Error('The package must not be private');
}
if (packageJson.peerDependencies?.react !== '^19.0.0'
  || packageJson.peerDependencies?.['react-dom'] !== '^19.0.0') {
  throw new Error('react and react-dom must remain external peer dependencies');
}
const reactRuntime = readFileSync(join(import.meta.dir, '..', 'dist', 'react.js'), 'utf8');
if (reactRuntime.includes('node_modules/react-dom/') || reactRuntime.includes('__require("react")')) {
  throw new Error('dist/react.js must not bundle the CommonJS React DOM runtime');
}
if (tag !== undefined && tag !== `v${packageJson.version}`) {
  throw new Error(`Tag ${tag} does not match package version ${packageJson.version}`);
}

console.log(`${packageJson.name}@${packageJson.version} is ready for public release`);
