import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {Supabase} from '../server/supabase.js';import {restoreBackup,createBackupFile} from '../server/backup.js';
const args=process.argv.slice(2),file=args.find(x=>!x.startsWith('--'));if(!file)throw Error('Informe o arquivo .ccbackup. Sem --apply, apenas valida o arquivo.');
const url=process.env.SUPABASE_URL,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY,encryptionKey=process.env.BACKUP_ENCRYPTION_KEY;
if(!url||!serviceKey||!encryptionKey)throw Error('Configuração de restauração incompleta.');const project=new URL(url).hostname,provider=new Supabase({url,key:serviceKey,serviceKey});
const result=await restoreBackup(provider,{text:await readFile(file,'utf8'),encryptionKey,project,apply:args.includes('--apply'),confirmation:args.find(x=>x.startsWith('--confirm-project='))?.split('=')[1],allowOverwrite:args.includes('--allow-overwrite'),allowCrossProject:args.includes('--allow-cross-project'),beforeRestore:()=>createBackupFile(provider,{project,encryptionKey,destination:resolve('backups','antes-restauracao-'+Date.now()+'.ccbackup')})});
console.log(JSON.stringify({event:'RESTORE_CHECK',...result}));
