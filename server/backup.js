import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {validateRecords,validateDre,revision} from './validation.js';
const MAX_BYTES=50*1024*1024;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function key(value){const b=Buffer.from(value||'','base64');if(b.length!==32)throw Error('BACKUP_ENCRYPTION_KEY deve conter 32 bytes em Base64, guardados fora das cópias.');return b;}
export function encryptBackup(snapshot,secret){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),iv);cipher.setAAD(Buffer.from('caixa-claro-financial-backup-v1'));const data=Buffer.concat([cipher.update(JSON.stringify(snapshot),'utf8'),cipher.final()]);return JSON.stringify({format:'caixa-claro-encrypted-v1',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});}
export function decryptBackup(text,secret){
 const envelope=JSON.parse(text);if(envelope.format!=='caixa-claro-encrypted-v1')throw Error('Formato de backup inválido.');
 const decipher=createDecipheriv('aes-256-gcm',key(secret),Buffer.from(envelope.iv,'base64'));decipher.setAAD(Buffer.from('caixa-claro-financial-backup-v1'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
 const snapshot=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8'));validateSnapshot(snapshot);return snapshot;
}
export function validateSnapshot(snapshot){
 if(snapshot?.format!=='caixa-claro-financial-v1'||!snapshot.project||!snapshot.datasets||!Array.isArray(snapshot.datasets.cashbooks)||!Array.isArray(snapshot.datasets.dre_books))throw Error('Backup inválido.');
 for(const table of ['cashbooks','dre_books']){const ids=new Set();for(const row of snapshot.datasets[table]){if(!UUID.test(row.user_id||'')||ids.has(row.user_id))throw Error('Identidade inválida no backup.');ids.add(row.user_id);revision(row.revision);if(table==='cashbooks')validateRecords(row.records);else validateDre(row.document);}}
}
export async function collectBackup(provider,project){
 const result={format:'caixa-claro-financial-v1',project,startedAt:new Date().toISOString(),datasets:{cashbooks:[],dre_books:[]}};let bytes=0;
 for(const table of ['cashbooks','dre_books']){
  let after=null;for(;;){const field=table==='cashbooks'?'records':'document';const path=`/rest/v1/${table}?select=user_id,revision,${field}&order=user_id.asc&limit=10`+(after?'&user_id=gt.'+after:'');const rows=await provider.request(path,{service:true});if(!Array.isArray(rows))throw Error('Resposta inválida ao exportar.');
   for(const row of rows){bytes+=Buffer.byteLength(JSON.stringify(row));if(bytes>MAX_BYTES)throw Error('Backup lógico excedeu 50 MB. Use backup PostgreSQL transacional para esse volume. Nenhum arquivo parcial foi concluído.');result.datasets[table].push(row);}
   if(rows.length<10)break;const next=rows.at(-1).user_id;if(!UUID.test(next)||next===after)throw Error('Paginação de backup inválida.');after=next;
  }
 }
 result.finishedAt=new Date().toISOString();validateSnapshot(result);return result;
}
export async function createBackupFile(provider,{project,encryptionKey,destination}){
 const snapshot=await collectBackup(provider,project),encrypted=encryptBackup(snapshot,encryptionKey),file=resolve(destination);await mkdir(dirname(file),{recursive:true,mode:0o700});await writeFile(file,encrypted,{mode:0o600,flag:'wx'});
 return {file,sha256:createHash('sha256').update(encrypted).digest('hex'),cashbooks:snapshot.datasets.cashbooks.length,dreBooks:snapshot.datasets.dre_books.length};
}
export async function restoreBackup(provider,{text,encryptionKey,project,apply=false,confirmation,allowOverwrite=false,allowCrossProject=false,beforeRestore}){
 const snapshot=decryptBackup(text,encryptionKey);
 if(snapshot.project!==project&&!allowCrossProject)throw Error('O backup pertence a outro projeto.');
 const summary={cashbooks:snapshot.datasets.cashbooks.length,dreBooks:snapshot.datasets.dre_books.length,sourceProject:snapshot.project,targetProject:project,dryRun:!apply};
 if(!apply)return summary;
 if(confirmation!==project)throw Error('Confirme explicitamente o hostname completo do projeto de destino.');
 if(typeof beforeRestore!=='function')throw Error('Uma cópia pré-restauração é obrigatória.');
 await provider.rpc('app_maintenance',{p_enabled:true},{service:true});await beforeRestore();
 // Se uma etapa falhar, manutenção permanece ativa. Reexecutar é idempotente.
 for(const table of ['cashbooks','dre_books'])for(const row of snapshot.datasets[table]){
  await provider.rpc('app_restore_financial',{p_table:table,p_user:row.user_id,p_revision:row.revision,p_data:table==='cashbooks'?row.records:row.document,p_overwrite:allowOverwrite},{service:true});
 }
 // Confirma os dados lidos antes de reabrir o serviço.
 const restored=await collectBackup(provider,project);
 for(const table of ['cashbooks','dre_books'])for(const row of snapshot.datasets[table]){
  const actual=restored.datasets[table].find(r=>r.user_id===row.user_id);const field=table==='cashbooks'?'records':'document';
  const canonical=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);
  if(!actual||canonical(actual[field])!==canonical(row[field]))throw Error('A validação da restauração falhou. O serviço permanece em manutenção.');
 }
 await provider.rpc('app_backup_mark',{p_status:'restore_verified'},{service:true});
 await provider.rpc('app_maintenance',{p_enabled:false},{service:true});return {...summary,dryRun:false};
}
