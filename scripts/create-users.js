// Recebe JSON exclusivamente pela entrada padrão. Não use senhas em argumentos.
import {openDatabase,createUser} from '../auth-server.js';
let input='';for await(const chunk of process.stdin)input+=chunk;
const users=JSON.parse(input),db=openDatabase();
try{db.exec('BEGIN');for(const user of users){const created=createUser(db,user.username,user.password);console.log(user.username+': '+(created?'conta criada':'conta já existente, mantida'));}db.exec('COMMIT');}catch(err){db.exec('ROLLBACK');throw err;}finally{db.close();}
