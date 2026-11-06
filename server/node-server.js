import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createPublicApi} from './public-api.js';
import {serverConfig} from './config.js';
export const staticFiles=['index.html','app.js','api.js','style.css','auth.css','auth.js','drafts.js','account.js','admin.js','telemetry.js','privacy.js','privacidade.html','finance.js','dre.html','dre.css','dre.js','dre-model.js'];
export function createPublicServer(config=serverConfig(),options={}){
 const handle=createPublicApi(config,options);
 return createServer(async(req,res)=>{
  try{
   const path=new URL(req.url,config.origin).pathname;
   if(path.startsWith('/api/')){
    const chunks=[];let length=0;for await(const c of req){length+=c.length;if(length>2_000_000){res.writeHead(413,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Solicitação muito grande.'}));}chunks.push(c);}
    const request=new Request(config.origin+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
    const response=await handle(request,{ip:req.socket.remoteAddress||'unknown'});res.statusCode=response.status;
    for(const [key,value]of response.headers)if(key.toLowerCase()!=='set-cookie')res.setHeader(key,value);
    const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies);
    return res.end(Buffer.from(await response.arrayBuffer()));
   }
   const name=path==='/'?'index.html':path.slice(1);
   if(req.method!=='GET'||!staticFiles.includes(name)){res.writeHead(404);return res.end('Não encontrado.');}
   const data=await readFile(new URL('../public/'+name,import.meta.url));const mime=name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css':'text/javascript';
   res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"});res.end(data);
  }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Não foi possível concluir a solicitação.'}));}
 });
}
