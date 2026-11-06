import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {staticFiles} from '../server/node-server.js';
export async function buildCloud(_configuration={},output=resolve('dist')){
 // Somente recursos públicos. Nenhum segredo ou .env é lido pelo gerador.
 await mkdir(output,{recursive:true});
 const expected=new Set([...staticFiles,'_headers']);
 const {readdir}=await import('node:fs/promises');
 for(const old of await readdir(output)){if(!expected.has(old))await rm(resolve(output,old),{recursive:true,force:true});}
 for(const name of staticFiles)await writeFile(resolve(output,name),await readFile(new URL('../public/'+name,import.meta.url)));
 await writeFile(resolve(output,'_headers'),"/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  X-Frame-Options: SAMEORIGIN\n  Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; frame-ancestors 'self'; base-uri 'none'; form-action 'self'\n  Cache-Control: no-cache\n");
}
if(process.argv[1]===new URL(import.meta.url).pathname){await buildCloud();console.log('Frontend gerado em dist. Publique também as funções e configure as variáveis do servidor.');}
