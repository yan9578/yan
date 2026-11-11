import {createPublicApi} from '../server/public-api.js';
import {serverConfig} from '../server/config.js';
import {createVercelAdapter} from '../server/vercel-adapter.js';
let api,config;
export default createVercelAdapter(()=>{
 if(!api){config=serverConfig();api=createPublicApi(config);}
 return api;
},()=>config.origin);
