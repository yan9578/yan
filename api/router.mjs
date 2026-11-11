import {createPublicApi} from '../server/public-api.js';
import {vercelConfig} from '../server/vercel-config.js';
import {createVercelAdapter} from '../server/vercel-adapter.js';
let api,config;
export default createVercelAdapter(()=>{
 if(!api){config=vercelConfig();api=createPublicApi(config);}
 return api;
},()=>config.origin);
