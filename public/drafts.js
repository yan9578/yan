// Somente rascunhos de gravações pendentes. Chave disponível após autenticação.
let identity=null,key=null;
const prefix='cc-pending-v1:';const lifetime=7*86400000;
const bytes=hex=>Uint8Array.from(hex.match(/../g)||[],x=>parseInt(x,16));
const encode=b=>{const a=new Uint8Array(b);let s='';for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode(...a.subarray(i,i+32768));return btoa(s);};
const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function setDraftIdentity(user){
 identity=user?.id||null;key=null;
 if(identity&&/^[a-f0-9]{64}$/.test(user.draftKey||'')&&globalThis.crypto?.subtle)key=await crypto.subtle.importKey('raw',bytes(user.draftKey),'AES-GCM',false,['encrypt','decrypt']);
}
function storageKey(scope){return prefix+identity+':'+scope;}
export async function rememberDraft(scope,payload){
 if(!identity||!key)return null;
 const owner=identity,id=crypto.randomUUID(),updatedAt=Date.now(),iv=crypto.getRandomValues(new Uint8Array(12));
 const plain=new TextEncoder().encode(JSON.stringify({id,scope,updatedAt,payload}));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(owner+':'+scope)},key,plain);
 const value=JSON.stringify({id,updatedAt,iv:encode(iv),data:encode(encrypted)});
 if(owner!==identity)return null;localStorage.setItem(storageKey(scope),value);return id;
}
export function acknowledgeDraft(scope,id){if(!identity||!id)return;try{const k=storageKey(scope),stored=JSON.parse(localStorage.getItem(k)||'null');if(stored?.id===id)localStorage.removeItem(k);}catch{}}
export async function pendingDrafts(){
 if(!identity||!key)return [];
 const owner=identity,draftKey=key,result=[];
 for(const scope of ['records','dre']){
  const k=storageKey(scope);let value;try{value=JSON.parse(localStorage.getItem(k)||'null');}catch{continue;}
  if(!value)continue;
  if(Date.now()-value.updatedAt>lifetime){localStorage.removeItem(k);continue;}
  try{const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(value.iv),additionalData:new TextEncoder().encode(owner+':'+scope)},draftKey,decode(value.data));const draft=JSON.parse(new TextDecoder().decode(data));
   if(draft.scope!==scope||draft.id!==value.id||!Number.isFinite(draft.updatedAt))throw Error('Rascunho inválido.');
   if(Date.now()-draft.updatedAt>lifetime){if(owner===identity)localStorage.removeItem(k);continue;}
   result.push(draft);
  }
  catch{result.push({scope,unreadable:true,updatedAt:value.updatedAt});}
 }
 return owner===identity?result:[];
}
export function discardDraft(scope){if(identity&&['records','dre'].includes(scope))localStorage.removeItem(storageKey(scope));}
