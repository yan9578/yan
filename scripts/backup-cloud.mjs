import {Supabase} from '../server/supabase.js';import {createBackupFile} from '../server/backup.js';import {resolve} from 'node:path';
const url=process.env.SUPABASE_URL,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!serviceKey||!process.env.BACKUP_ENCRYPTION_KEY)throw Error('Configure as variáveis privadas do backup; consulte docs/BACKUPS.md.');
const provider=new Supabase({url,key:serviceKey,serviceKey});
const destination=process.argv[2]||resolve('backups','caixa-'+new Date().toISOString().replace(/[:.]/g,'-')+'.ccbackup');
const result=await createBackupFile(provider,{project:new URL(url).hostname,encryptionKey:process.env.BACKUP_ENCRYPTION_KEY,destination});
await provider.rpc('app_backup_mark',{p_status:'archive_created',p_sha:result.sha256},{service:true});
await provider.rpc('app_cleanup',{}, {service:true});
console.log(JSON.stringify({event:'BACKUP_CREATED',...result}));
