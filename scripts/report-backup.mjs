import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {Supabase} from '../server/supabase.js';
const url=process.env.SUPABASE_URL,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!serviceKey)throw Error('Configuração de monitoramento de backup ausente.');
const provider=new Supabase({url,key:serviceKey,serviceKey});const failed=process.argv[2]==='--failed';let hash=null;
if(!failed){if(process.argv[2]!=='--uploaded'||!process.argv[3])throw Error('Use --uploaded ARQUIVO somente depois de confirmar o envio externo.');hash=createHash('sha256').update(await readFile(process.argv[3])).digest('hex');}
await provider.rpc('app_backup_mark',{p_status:failed?'failed':'external_uploaded',p_sha:hash},{service:true});console.log(failed?'Falha de backup registrada.':'Envio externo de backup confirmado no monitoramento.');
