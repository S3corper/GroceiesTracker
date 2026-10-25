import { createRequire } from 'node:module';
import { copyFile, mkdir, readdir, access } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(root,'lib/api-client-react/package.json'));
const target=path.join(root,'artifacts/groceries-tracker/public/ocr');
await mkdir(target,{recursive:true});
await copyFile(require.resolve('tesseract.js/dist/worker.min.js'),path.join(target,'worker.min.js'));
const core=path.dirname(createRequire(require.resolve('tesseract.js')).resolve('tesseract.js-core/package.json'));
for(const file of await readdir(core)){if(/^tesseract-core.*\.wasm(?:\.js)?$/.test(file)) await copyFile(path.join(core,file),path.join(target,file));}
const model=path.join(root,'artifacts/api-server/assets/tessdata/eng.traineddata');
await access(model);
await copyFile(model,path.join(target,'eng.traineddata'));
console.log('Prepared self-hosted OCR worker, WASM and English model.');
