import {randomBytes,createHash,createHmac,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
export const sha256=s=>createHash('sha256').update(s).digest('hex');
export const opaque=()=>randomBytes(32).toString('hex');
export function secretKey(secret,purpose){return createHmac('sha256',secret).update('caixa-claro:'+purpose).digest();}
export function seal(value,secret,purpose='tokens'){
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secretKey(secret,purpose),nonce);cipher.setAAD(Buffer.from(purpose));
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
 return Buffer.concat([nonce,cipher.getAuthTag(),ciphertext]).toString('base64url');
}
export function unseal(value,secret,purpose='tokens'){
 if(typeof value!=='string'||value.length>16384||!(/^[A-Za-z0-9_-]+$/).test(value))throw Error('Invalid sealed value');
 const buf=Buffer.from(value,'base64url');if(buf.length<29||buf.toString('base64url')!==value)throw Error('Invalid sealed value');
 const decipher=createDecipheriv('aes-256-gcm',secretKey(secret,purpose),buf.subarray(0,12));decipher.setAAD(Buffer.from(purpose));decipher.setAuthTag(buf.subarray(12,28));
 return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)),decipher.final()]).toString('utf8'));
}
export function cookie(name,value,{secure=true,maxAge,path='/api',sameSite='Strict'}={}){if(!['Strict','Lax'].includes(sameSite))throw Error('Invalid cookie policy');return `${name}=${value}; Path=${path}; HttpOnly; SameSite=${sameSite}${secure?'; Secure':''}${maxAge===undefined?'':`; Max-Age=${maxAge}`}`;}
export function cookies(header=''){return Object.fromEntries(String(header||'').split(';').map(v=>v.trim().split(/=(.*)/s)).filter(v=>v[0]));}
export function safeEqual(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);}
export function redactError(error){return {code:error?.code==='ECONNREFUSED'?'UPSTREAM_UNAVAILABLE':'REQUEST_FAILED'};}
