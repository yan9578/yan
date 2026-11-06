"""Servidor local alternativo, exclusivamente em 127.0.0.1, com Python padrão."""
import json, sqlite3, hashlib, secrets, hmac, time, os, re, sys
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from http.cookies import SimpleCookie
ROOT=Path(__file__).resolve().parent
DATA=ROOT/'dados';DATA.mkdir(mode=0o700,exist_ok=True)
db=sqlite3.connect(DATA/'caixa.sqlite');os.chmod(DATA/'caixa.sqlite',0o600)
db.executescript('''CREATE TABLE IF NOT EXISTS users(name TEXT PRIMARY KEY, display TEXT, salt TEXT, hash TEXT, revision INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS records(owner TEXT,id TEXT,data TEXT,PRIMARY KEY(owner,id));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,owner TEXT,expires REAL);
CREATE TABLE IF NOT EXISTS attempts(name TEXT PRIMARY KEY,n INTEGER,until REAL);''')
credentials=ROOT/'contas-iniciais.json'
if credentials.exists():
    for user in json.loads(credentials.read_text()):
        db.execute('INSERT OR IGNORE INTO users(name,display,salt,hash) VALUES(?,?,?,?)',(user['name'].lower(),user['name'],user['salt'],user['hash']))
    db.commit()
def hashed(value): return hashlib.sha256(value.encode()).hexdigest()
def valid_record(r):
    from datetime import date
    assert isinstance(r,dict) and re.fullmatch('[A-Za-z0-9-]{1,80}',r['id'])
    assert type(r['amount']) is int and 0<r['amount']<=10**12
    assert r['type'] in ['income','expense'] and r['method'] in ['Pix','Dinheiro','Débito','Crédito']
    assert isinstance(r['description'],str) and 0<len(r['description'].strip())<=120
    assert isinstance(r['category'],str) and len(r['category'])<=60
    assert date.fromisoformat(r['date']).isoformat()==r['date']
    if r.get('saleDate'): assert date.fromisoformat(r['saleDate']).isoformat()==r['saleDate'] and r['saleDate']<=r['date']
    return {k:r.get(k,'') for k in ['id','amount','type','method','description','category','date','saleDate']}
class Site(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def reply(self,status,data,cookie=None,mime='application/json; charset=utf-8'):
        raw=data if isinstance(data,bytes) else json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','same-origin')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if cookie:self.send_header('Set-Cookie',cookie)
        self.end_headers();self.wfile.write(raw)
    def error(self,status,message): self.reply(status,{'error':message})
    def do_GET(self): self.handle_request()
    def do_POST(self): self.handle_request()
    def do_PUT(self): self.handle_request()
    def handle_request(self):
        path=self.path.split('?')[0]
        try:
            if not path.startswith('/api/'):
                files={'/':('index.html','text/html; charset=utf-8'),'/app.js':('app.js','text/javascript'),'/finance.js':('finance.js','text/javascript'),'/style.css':('style.css','text/css')}
                if self.command!='GET' or path not in files:return self.error(404,'Não encontrado.')
                name,mime=files[path];return self.reply(200,(ROOT/'public'/name).read_bytes(),mime=mime)
            body={}
            if self.command!='GET':
                expected={'http://127.0.0.1:8766','http://localhost:8766'}
                if self.headers.get('Origin') not in expected or not self.headers.get('Content-Type','').startswith('application/json'):return self.error(403,'Solicitação não autorizada.')
                length=int(self.headers.get('Content-Length','0'))
                if length>2000000:return self.error(413,'Solicitação muito grande.')
                body=json.loads(self.rfile.read(length))
            cookies=SimpleCookie();cookies.load(self.headers.get('Cookie',''));token=cookies['session'].value if 'session' in cookies else ''
            now=time.time()
            if path=='/api/login' and self.command=='POST':
                name=str(body.get('username','')).strip().lower();password=body.get('password','')
                if not isinstance(password,str) or len(password)>256:return self.error(401,'Usuário ou senha inválidos.')
                user=db.execute('SELECT name,display,salt,hash FROM users WHERE name=?',(name,)).fetchone()
                key=name if user else '*';attempt=db.execute('SELECT n,until FROM attempts WHERE name=?',(key,)).fetchone()
                if attempt and attempt[0]>=5 and attempt[1]>now:return self.error(429,'Muitas tentativas. Aguarde 15 minutos.')
                salt=user[2] if user else '0'*32
                check=hashlib.scrypt(password.encode(),salt=salt.encode(),n=16384,r=8,p=1,dklen=64).hex()
                if not user or not hmac.compare_digest(check,user[3]):
                    count=attempt[0]+1 if attempt and attempt[1]>now else 1
                    until=attempt[1] if attempt and attempt[1]>now else now+900
                    db.execute('INSERT OR REPLACE INTO attempts VALUES(?,?,?)',(key,count,until));db.commit();return self.error(401,'Usuário ou senha inválidos.')
                db.execute('DELETE FROM attempts WHERE name=?',(key,));db.execute('DELETE FROM sessions WHERE expires<? OR token=?',(now,hashed(token)))
                new=secrets.token_hex(32);db.execute('INSERT INTO sessions VALUES(?,?,?)',(hashed(new),name,now+28800));db.commit()
                return self.reply(200,{'username':user[1]},f'session={new}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800')
            user=db.execute('SELECT users.name,display,revision FROM users JOIN sessions ON users.name=sessions.owner WHERE sessions.token=? AND expires>?',(hashed(token),now)).fetchone()
            if not user:return self.error(401,'Entre na sua conta para continuar.')
            name,display,revision=user
            if path=='/api/me' and self.command=='GET':return self.reply(200,{'username':display})
            if path=='/api/logout' and self.command=='POST':
                db.execute('DELETE FROM sessions WHERE token=?',(hashed(token),));db.commit();return self.reply(200,{'ok':True},'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
            if path=='/api/records' and self.command=='GET':return self.reply(200,{'revision':revision,'records':[json.loads(r[0]) for r in db.execute('SELECT data FROM records WHERE owner=?',(name,))]})
            if path=='/api/records' and self.command=='PUT':
                if not isinstance(body.get('records'),list) or len(body['records'])>5000:return self.error(400,'Dados inválidos.')
                rows=[valid_record(r) for r in body['records']]
                assert len(set(r['id'] for r in rows))==len(rows)
                if body.get('revision')!=revision:return self.error(409,'Dados atualizados em outra janela. Confira e tente novamente.')
                with db:
                    db.execute('UPDATE users SET revision=revision+1 WHERE name=?',(name,));db.execute('DELETE FROM records WHERE owner=?',(name,));db.executemany('INSERT INTO records VALUES(?,?,?)',[(name,r['id'],json.dumps(r,ensure_ascii=False)) for r in rows])
                return self.reply(200,{'revision':revision+1})
            return self.error(404,'Não encontrado.')
        except (ValueError,KeyError,TypeError,AssertionError):db.rollback();self.error(400,'Dados inválidos.')
        except Exception:db.rollback();self.error(500,'Não foi possível concluir. Seus dados anteriores foram preservados.')
try:
    server=HTTPServer(('127.0.0.1',8766),Site)
except OSError:
    raise SystemExit('A porta 8766 está ocupada. Feche o teste anterior desta versão e execute novamente.')
print('\nCAIXA CLARO COM LOGIN PRONTO!\nAbra no navegador: http://127.0.0.1:8766\nDeixe este Terminal aberto. Para encerrar: Ctrl+C.\n',flush=True)
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:server.server_close();db.close()
