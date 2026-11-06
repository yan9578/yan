import {createPublicApi} from '../../server/public-api.js';
import {serverConfig} from '../../server/config.js';
let handler;
export default async function(request,context){
 if(!handler){try{handler=createPublicApi(serverConfig());}catch{return Response.json({error:'O serviço ainda precisa de configuração pelo responsável.',code:'SERVER_NOT_CONFIGURED'},{status:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}}
 return handler(request,{ip:context.ip||'unknown'});
}
