import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {createVercelAdapter} from '../server/vercel-adapter.js';
import {createPublicApi} from '../server/public-api.js';
import {createPublicServer} from '../server/node-server.js';
const routing=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url)));

// Emula apenas o rewrite e IncomingMessage da plataforma. Auth/SQL são os mesmos
// testes de integração; não é uma publicação real nem um emulador da Vercel.
export function vercelTestServer(config,options={}){
 const api=createPublicApi(config,options),adapter=createVercelAdapter(()=>api,()=>config.origin),staticServer=createPublicServer(config,options);
 return createServer((req,res)=>{
  const url=new URL(req.url,config.origin);
  if(url.pathname.startsWith('/api/')){
   const destination=new URL(routing.rewrites[0].destination.replace(':path*',url.pathname.slice(5)),config.origin);
   for(const [key,value]of url.searchParams)destination.searchParams.append(key,value);
   req.url=destination.pathname+destination.search;
   req.headers['x-vercel-forwarded-for']=req.socket.remoteAddress;
   return adapter(req,res);
  }
  staticServer.emit('request',req,res);
 });
}
