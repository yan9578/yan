import {fileURLToPath} from 'node:url';
import {createUser, makeServer} from '../auth-server.js';

const host = '127.0.0.1';
const port = Number(process.argv[2] || 4179);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Porta inválida.');
const origin = 'http://'+host+':'+port;
const database = fileURLToPath(new URL('../.data-preview/caixa.sqlite',import.meta.url));
const {server,db} = makeServer({database,origin,production:false,preview:true});
if (createUser(db,'demonstracao','CaixaTeste2026')) {
  const user = db.prepare('SELECT id FROM users WHERE username=?').get('demonstracao');
  const document = {version:1,companies:[{id:'empresa-teste',name:'Empresa de Teste',sector:''}],entries:[]};
  db.prepare('INSERT INTO dre_books VALUES(?,?,?)').run(user.id,1,JSON.stringify(document));
}
server.listen(port,host,()=>{
  console.log('CaixaClaro · Prévia local disponível em '+origin);
  console.log('Usuário: demonstracao | Senha: CaixaTeste2026');
});
