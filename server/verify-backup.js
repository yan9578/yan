import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {decryptBackup,restoreBackup,createBackupFile} from './backup.js';
import {platformDatabase} from '../test-support/platform-db.js';
import {TestProvider} from '../test-support/provider.js';

// Ensaio em PostgreSQL/PGlite temporário, sem conexão ao banco de origem.
export async function verifyEncryptedBackup({text,encryptionKey,project}){
 const snapshot=decryptBackup(text,encryptionKey);
 if(snapshot.project!==project)throw Error('Projeto do backup diferente do esperado.');
 const database=await platformDatabase();let directory;
 try{
  directory=await mkdtemp(join(tmpdir(),'caixa-restore-check-'));
  const ids=new Set([...snapshot.datasets.cashbooks,...snapshot.datasets.dre_books].map(row=>row.user_id));
  for(const id of ids)await database.db.query('insert into auth.users(id) values($1)',[id]);
  const provider=new TestProvider(database);
  await restoreBackup(provider,{text,encryptionKey,project,apply:true,confirmation:project,beforeRestore:()=>createBackupFile(provider,{project,encryptionKey,destination:join(directory,'before.ccbackup')})});
  return {scope:'isolated-postgresql',cashbooks:snapshot.datasets.cashbooks.length,dreBooks:snapshot.datasets.dre_books.length};
 }finally{await database.close();if(directory)await rm(directory,{recursive:true,force:true});}
}
