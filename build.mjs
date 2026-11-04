import {build} from 'esbuild';import {mkdir,copyFile} from 'node:fs/promises';await mkdir('dist',{recursive:true});await build({entryPoints:['src/main.ts'],bundle:true,outfile:'dist/app.js',format:'esm',minify:true,external:['/brand-caveat-400.ttf','/brand-instrument-serif.ttf','/body-manrope.ttf']});await copyFile('index.html','dist/index.html');await build({entryPoints:['src/worker.ts'],bundle:true,outfile:'worker-dist/index.js',format:'esm',platform:'browser'});

await build({entryPoints:['src/masks.ts'],bundle:true,outfile:'dist/mask-compositor.js',format:'esm',minify:true});

await build({entryPoints:['src/server/routes.ts'],bundle:true,outfile:'server-dist/api.mjs',format:'esm',platform:'node',target:'node22'});

await copyFile('assets/fonts/caveat.ttf','dist/brand-caveat-400.ttf');
await copyFile('assets/fonts/Caveat-OFL.txt','dist/font-license.txt');

// Only the explicitly approved synthetic sample manifest is copied into public assets.
{const {readFile}=await import('node:fs/promises');const manifest=JSON.parse(await readFile('assets/samples/manifest.json','utf8'));await mkdir('dist/samples',{recursive:true});for(const item of manifest.files){if(!/^[a-z0-9-]+\.png$/.test(item.file))throw Error('sample filename');await copyFile('assets/samples/'+item.file,'dist/samples/'+item.file);}}

// Unlinked local device diagnosis and separate safety copy. No provider transport or original-record writes.
await build({entryPoints:['src/device-check.ts'],bundle:true,outfile:'dist/device-check.js',format:'esm',minify:true});await copyFile('device-check.html','dist/device-check.html');

for(const icon of ['wardrobe.svg','wardrobe-16.png','wardrobe-32.png','favicon.ico'])await copyFile('assets/icons/'+icon,'dist/'+icon);

// Approved self-hosted typography; licences travel with the built app.
for(const [source,target]of [['instrument-serif.ttf','brand-instrument-serif.ttf'],['manrope.ttf','body-manrope.ttf'],['InstrumentSerif-OFL.txt','instrument-serif-license.txt'],['Manrope-OFL.txt','manrope-license.txt']])await copyFile('assets/fonts/'+source,'dist/'+target);
