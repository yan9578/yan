import {test} from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {encryptBackup} from '../server/backup.js';import {verifyEncryptedBackup} from '../server/verify-backup.js';
import {A} from '../test-support/platform-db.js';

test('cópia criptografada é restaurada e comparada em SQL isolado, sem acesso à rede',async()=>{
 const snapshot={format:'caixa-claro-financial-v1',project:'test.supabase.co',datasets:{cashbooks:[{user_id:A,revision:2,records:[{id:'r',amount:10101,type:'income',method:'Pix',date:'2026-11-01',saleDate:'',description:'Valor privado',category:'Venda'}]}],dre_books:[{user_id:A,revision:3,document:{version:1,companies:[{id:'c',name:'Empresa privada',sector:''}],entries:[{id:'e',company:'c',category:'sales',date:'2026-11-01',description:'Serviço privado',amount:20202}]}}]}};
 const key=randomBytes(32).toString('base64'),text=encryptBackup(snapshot,key),previous=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('O ensaio não pode acessar serviços remotos.');};
 try{
  assert.deepEqual(await verifyEncryptedBackup({text,encryptionKey:key,project:snapshot.project}),{scope:'isolated-postgresql',cashbooks:1,dreBooks:1});
  await assert.rejects(verifyEncryptedBackup({text,encryptionKey:randomBytes(32).toString('base64'),project:snapshot.project}));
  await assert.rejects(verifyEncryptedBackup({text,encryptionKey:key,project:'outro.supabase.co'}));
 }finally{globalThis.fetch=previous;}
});
