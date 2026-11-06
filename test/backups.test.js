import {test} from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {platformDatabase,A} from '../test-support/platform-db.js';import {seedProvider} from '../test-support/provider.js';import {encryptBackup,decryptBackup,collectBackup,createBackupFile,restoreBackup} from '../server/backup.js';
test('backup criptografado restaura valores reais no PostgreSQL e invalida revisões antigas',async()=>{
 const pg=await platformDatabase(),dir=await mkdtemp(join(tmpdir(),'caixa-backup-'));try{
  const {provider}=await seedProvider(pg),key=randomBytes(32).toString('base64'),project='test.supabase.co';
  const row={id:'a',amount:125050,type:'income',method:'Pix',description:'Receita sigilosa',category:'Vendas',date:'2026-11-01',saleDate:''};const doc={version:1,companies:[{id:'c',name:'Minha empresa',sector:''}],entries:[{id:'dre',company:'c',date:'2026-11-01',description:'Venda sigilosa',category:'sales',amount:200000}]};
  await pg.rpc('save_cashbook',{expected_revision:0,new_records:[row]},'authenticated',A);await pg.rpc('save_dre_book',{expected_revision:0,new_document:doc},'authenticated',A);
  const info=await createBackupFile(provider,{project,encryptionKey:key,destination:join(dir,'snapshot.ccbackup')});const text=await readFile(info.file,'utf8');assert.ok(!text.includes('Receita sigilosa'));assert.ok(!text.includes('Minha empresa'));assert.equal(info.cashbooks,1);assert.equal(info.dreBooks,1);
  assert.throws(()=>decryptBackup(text,randomBytes(32).toString('base64')));const tampered=JSON.parse(text);tampered.tag=Buffer.alloc(16).toString('base64');assert.throws(()=>decryptBackup(JSON.stringify(tampered),key));
  const dry=await restoreBackup(provider,{text,encryptionKey:key,project});assert.equal(dry.dryRun,true);assert.equal(dry.cashbooks,1);
  await assert.rejects(restoreBackup(provider,{text,encryptionKey:key,project:'wrong.supabase.co'}));
  await pg.rpc('save_cashbook',{expected_revision:1,new_records:[{...row,amount:1}]},'authenticated',A);
  const previous=join(dir,'before.ccbackup');const result=await restoreBackup(provider,{text,encryptionKey:key,project,apply:true,confirmation:project,allowOverwrite:true,beforeRestore:()=>createBackupFile(provider,{project,encryptionKey:key,destination:previous})});assert.equal(result.dryRun,false);
  const restored=await collectBackup(provider,project);assert.equal(restored.datasets.cashbooks[0].records[0].amount,125050);assert.equal(restored.datasets.dre_books[0].document.entries[0].amount,200000);assert.ok(restored.datasets.cashbooks[0].revision>2);assert.equal(await pg.rpc('app_maintenance',{}),false);assert.ok((await pg.rpc('app_backup_health',{})).lastRestoreAt);
  const before=decryptBackup(await readFile(previous,'utf8'),key);assert.equal(before.datasets.cashbooks[0].records[0].amount,1);
  // Falha deixa o serviço em manutenção; nenhuma restauração oculta erro.
  await pg.rpc('save_cashbook',{expected_revision:restored.datasets.cashbooks[0].revision,new_records:[]},'authenticated',A);
  await assert.rejects(restoreBackup(provider,{text,encryptionKey:key,project,apply:true,confirmation:project,beforeRestore:async()=>{}}));assert.equal(await pg.rpc('app_maintenance',{}),true);
 }finally{await pg.close();await rm(dir,{recursive:true,force:true});}
});
