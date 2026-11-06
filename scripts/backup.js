import {backup} from 'node:sqlite';
import {mkdirSync,chmodSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {openDatabase} from '../auth-server.js';
if(!process.argv[2])throw Error('Informe o destino: node scripts/backup.js /caminho/seguro/backup.sqlite');
const dest=resolve(process.argv[2]);if(existsSync(dest))throw Error('Destino já existe; informe outro nome.');
mkdirSync(dirname(dest),{recursive:true,mode:0o700});const db=openDatabase();
try{await backup(db,dest);chmodSync(dest,0o600);console.log('Backup concluído. Guarde uma cópia fora deste ambiente.');}finally{db.close();}
