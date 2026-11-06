import {staticFiles} from './server/node-server.js';
import {M as DRE} from './public/dre-model.js';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
export const defaultDatabase=resolve(process.env.DATA_DIR||new URL('./.data/',import.meta.url).pathname,'caixa.sqlite');
const digest=s=>createHash('sha256').update(s).digest('hex');
function hashPassword(password,salt=randomBytes(16).toString('hex')){return salt+':'+scryptSync(password,salt,64).toString('hex');}
function passwordMatches(password,stored){const [salt,hash]=stored.split(':');return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(hash,'hex'));}
export function openDatabase(file=defaultDatabase){mkdirSync(dirname(file),{recursive:true,mode:0o700});const db=new DatabaseSync(file);chmodSync(file,0o600);db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS records(user_id INTEGER NOT NULL REFERENCES users(id), id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(user_id,id));
CREATE TABLE IF NOT EXISTS attempts(username TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS dre_books(user_id INTEGER PRIMARY KEY REFERENCES users(id), revision INTEGER NOT NULL, document TEXT NOT NULL);`);return db;}
export function createUser(db,name,password){if(!/^[A-Za-z0-9_]{2,40}$/.test(name)||typeof password!=='string'||password.length<8)throw Error('Nome ou senha inválidos.');if(db.prepare('SELECT id FROM users WHERE username=?').get(name.toLowerCase()))return false;db.prepare('INSERT INTO users(username,display_name,password_hash) VALUES (?,?,?)').run(name.toLowerCase(),name,hashPassword(password));return true;}
function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
function cleanRecord(r){if(!r||typeof r.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(r.id)||!['income','expense'].includes(r.type)||!['Pix','Dinheiro','Débito','Crédito'].includes(r.method)||!Number.isSafeInteger(r.amount)||r.amount<=0||r.amount>1e12||typeof r.description!=='string'||!r.description.trim()||r.description.length>120||typeof r.category!=='string'||r.category.length>60||!validDate(r.date)||(r.saleDate&&(!validDate(r.saleDate)||r.saleDate>r.date)))throw Error('Lançamento inválido.');return Object.fromEntries(['id','type','method','amount','description','category','date','saleDate'].map(k=>[k,r[k]??'']));}
async function jsonBody(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>2_000_000)throw Error('Solicitação muito grande.');}return JSON.parse(text);}
export function makeServer({database=defaultDatabase,origin=process.env.APP_ORIGIN,production=process.env.NODE_ENV==='production'}={}){
 if(production&&(!origin||!origin.startsWith('https://')))throw Error('Configure APP_ORIGIN com HTTPS em produção.');
 const db=openDatabase(database),dummyHash=hashPassword(randomBytes(24).toString('hex'));
 const files=Object.fromEntries(staticFiles.map(f=>['/'+f,f]));files['/']='index.html';
 const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
  if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  const cookie=(value,age)=>res.setHeader('Set-Cookie',`session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${production?'; Secure':''}`);
  try{
   const path=new URL(req.url,'http://localhost').pathname;
   if(path.startsWith('/api/')){
    if(!['GET','HEAD'].includes(req.method)&& (req.headers.origin!==(origin||`http://${req.headers.host}`)||!req.headers['content-type']?.startsWith('application/json')))return send(403,{error:'Solicitação não autorizada.'});
    if(path==='/api/config'&&req.method==='GET')return send(200,{publicAuth:false,serverMode:false,privacy:{controller:'',contact:''}});
    if(path==='/api/login'&&req.method==='POST'){
     const body=await jsonBody(req),name=String(body.username||'').trim().toLowerCase();
     if(typeof body.password!=='string'||body.password.length>256)return send(400,{error:'Usuário ou senha inválidos.'});
     const user=db.prepare('SELECT * FROM users WHERE username=?').get(name),key=user?name:'*',now=Date.now();
     const attempt=db.prepare('SELECT * FROM attempts WHERE username=?').get(key);
     if(attempt&&attempt.until>now&&attempt.count>=5)return send(429,{error:'Muitas tentativas. Aguarde 15 minutos.'});
     if(!passwordMatches(body.password,user?.password_hash||dummyHash)||!user){db.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(username) DO UPDATE SET count=CASE WHEN until>? THEN count+1 ELSE 1 END, until=CASE WHEN until>? THEN until ELSE excluded.until END').run(key,now+900000,now,now);return send(401,{error:'Usuário ou senha inválidos.'});}
     db.prepare('DELETE FROM attempts WHERE username=?').run(key);db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
     const oldToken=/\bsession=([a-f0-9]{64})\b/.exec(req.headers.cookie||'')?.[1];if(oldToken)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(oldToken));
     const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),user.id,now+8*3600000);cookie(token,8*3600);return send(200,{username:user.display_name});
    }
    const token=/\bsession=([a-f0-9]{64})\b/.exec(req.headers.cookie||'')?.[1];
    const user=token&&db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>?').get(digest(token),Date.now());
    if(!user)return send(401,{error:'Entre na sua conta para continuar.'});
    if(path==='/api/me'&&req.method==='GET')return send(200,{username:user.display_name,isAdmin:false});
    if(path==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));cookie('',0);return send(200,{ok:true});}
    if(path==='/api/records'&&req.method==='GET')return send(200,{revision:user.revision,records:db.prepare('SELECT data FROM records WHERE user_id=?').all(user.id).map(x=>JSON.parse(x.data))});
    if(path==='/api/records'&&req.method==='PUT'){
     const body=await jsonBody(req);if(!Array.isArray(body.records)||body.records.length>5000||!Number.isSafeInteger(body.revision))return send(400,{error:'Dados inválidos.'});
     const rows=body.records.map(cleanRecord);if(new Set(rows.map(x=>x.id)).size!==rows.length)return send(400,{error:'Lançamentos duplicados.'});
     db.exec('BEGIN IMMEDIATE');try{
      const result=db.prepare('UPDATE users SET revision=revision+1 WHERE id=? AND revision=?').run(user.id,body.revision);
      if(!result.changes){db.exec('ROLLBACK');return send(409,{error:'Seus dados mudaram em outra janela. Revise os dados atualizados e tente novamente.'});}
      db.prepare('DELETE FROM records WHERE user_id=?').run(user.id);const insert=db.prepare('INSERT INTO records VALUES(?,?,?)');for(const row of rows)insert.run(user.id,row.id,JSON.stringify(row));db.exec('COMMIT');
     }catch(err){db.exec('ROLLBACK');throw err;}
     return send(200,{revision:body.revision+1});
    }
    if(path==='/api/dre'&&req.method==='GET'){
     const book=db.prepare('SELECT revision,document FROM dre_books WHERE user_id=?').get(user.id);
     return send(200,book?{revision:book.revision,document:JSON.parse(book.document)}:{revision:0,document:DRE.empty()});
    }
    if(path==='/api/dre'&&req.method==='PUT'){
     const body=await jsonBody(req);
     if(!Number.isSafeInteger(body.revision)||body.revision<0)return send(400,{error:'Versão inválida.'});
     try{DRE.validate(body.document);}catch{return send(400,{error:'Dados da DRE inválidos.'});}
     db.exec('BEGIN IMMEDIATE');
     try{
      const previous=db.prepare('SELECT revision FROM dre_books WHERE user_id=?').get(user.id);
      if((previous?.revision??0)!==body.revision){db.exec('ROLLBACK');return send(409,{error:'Sua DRE mudou em outra janela. Confira os dados atualizados e tente novamente.'});}
      db.prepare('INSERT INTO dre_books VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,document=excluded.document').run(user.id,body.revision+1,JSON.stringify(body.document));
      db.exec('COMMIT');
     }catch(err){db.exec('ROLLBACK');throw err;}
     return send(200,{revision:body.revision+1});
    }
    return send(404,{error:'Não encontrado.'});
   }
   if(req.method!=='GET'||!files[path]){res.writeHead(404);return res.end('Não encontrado');}
   const file=files[path],data=await readFile(new URL('./public/'+file,import.meta.url));res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript'});res.end(data);
  }catch(err){if(!res.headersSent)send(err instanceof SyntaxError||err.message==='Lançamento inválido.'?400:500,{error:err.message==='Lançamento inválido.'?err.message:'Não foi possível concluir a solicitação.'});else res.end();}
 });
 server.on('close',()=>db.close());return {server,db};
}
