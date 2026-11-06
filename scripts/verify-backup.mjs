import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyEncryptedBackup} from '../server/verify-backup.js';
import {Supabase} from '../server/supabase.js';

try{
 const file=process.argv[2],url=process.env.SUPABASE_URL,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY,encryptionKey=process.env.BACKUP_ENCRYPTION_KEY;
 if(!file||!url||!serviceKey||!encryptionKey)throw Error();
 const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.origin!==url||!parsed.hostname.endsWith('.supabase.co'))throw Error();
 const text=await readFile(file,'utf8');
 const result=await verifyEncryptedBackup({text,encryptionKey,project:parsed.hostname});
 // Apenas metadados do ensaio são escritos no banco real, após a comparação.
 await new Supabase({url,key:serviceKey,serviceKey}).rpc('app_backup_mark',{p_status:'restore_verified',p_sha:createHash('sha256').update(text).digest('hex')},{service:true});
 console.log(JSON.stringify({event:'BACKUP_RESTORE_VERIFIED',...result}));
}catch{
 // Erros SQL podem conter dados de uma linha; não os registrar no runner.
 console.error('A conferência da recuperação falhou. Verifique a chave, o projeto e a compatibilidade dos dados. Nenhum documento financeiro foi restaurado no banco de origem.');
 process.exitCode=1;
}
