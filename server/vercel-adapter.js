import {isIP} from 'node:net';

// A regra de rewrite transporta a rota pública neste parâmetro reservado.
// Os demais parâmetros (code do OAuth, days etc.) chegam à API sem alteração.
export function createVercelAdapter(getApi,getOrigin){
 return async function(req,res){
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  try{
   const api=getApi(),url=new URL(req.url,getOrigin());
   const routes=url.searchParams.getAll('__cc_route');
   // A Vercel pode expor parâmetros de rewrite em req.query, mantendo req.url original.
   const route=routes.length===1?routes[0]:routes.length===0?req.query?.__cc_route:null;
   if(typeof route!=='string'||!/^[-a-zA-Z0-9_/]{1,200}$/.test(route)||route.split('/').some(s=>!s))return json(404,{error:'Rota não encontrada.',code:'NOT_FOUND'});
   url.pathname='/api/'+route;url.searchParams.delete('__cc_route');
   // O Host e os cabeçalhos encaminhados não determinam o destino de retorno.
   const target=new URL(url.pathname+url.search,getOrigin());
   let body;
   if(!['GET','HEAD'].includes(req.method)){
    if(req.body!==undefined){body=Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body));}
    else{const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>2_000_000)return json(413,{error:'Solicitação muito grande.'});chunks.push(chunk);}body=Buffer.concat(chunks);}
    if(body.length>2_000_000)return json(413,{error:'Solicitação muito grande.'});
   }
   const headers=new Headers();for(const [name,value]of Object.entries(req.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);
   const forwarded=headers.get('x-vercel-forwarded-for')?.split(',')[0].trim();
   const request=new Request(target,{method:req.method,headers,body});
   const response=await api(request,{ip:isIP(forwarded||'')?forwarded:'unknown'});
   res.statusCode=response.status;
   for(const [key,value]of response.headers)if(key!=='set-cookie')res.setHeader(key,value);
   const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies);
   res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){
   if(error.statusCode===400)return json(400,{error:'Dados inválidos.',code:'REQUEST_FAILED'});
   if(error.configVariable){const allowed=['SUPABASE_URL','APP_ORIGIN','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','SESSION_SECRET','PUBLIC_AUTH_ENABLED'];return json(503,{error:'O serviço ainda precisa de configuração pelo responsável.',code:'SERVER_NOT_CONFIGURED',...(allowed.includes(error.configVariable)?{variable:error.configVariable,reason:['MISSING','INVALID_FORMAT','TOO_SHORT'].includes(error.configReason)?error.configReason:'INVALID_FORMAT'}:{})});}
   return json(500,{error:'Não foi possível concluir a solicitação.',code:'REQUEST_FAILED'});
  }
 };
}
