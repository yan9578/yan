import {setDraftIdentity,rememberDraft,acknowledgeDraft} from './drafts.js';
let reporting=false;
const pendingReports=[];
async function reportConnectionFailures(){
 if(reporting||!pendingReports.length)return;reporting=true;
 try{while(pendingReports.length){const report=pendingReports[0];const response=await fetch('/api/client-error',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(report),signal:AbortSignal.timeout(5000)});if(!response.ok)break;pendingReports.shift();}}catch{}finally{reporting=false;}
}
window.addEventListener('online',reportConnectionFailures);
const sendState=(state,detail={})=>window.dispatchEvent(new CustomEvent('caixa:save-state',{detail:{state,...detail}}));
export async function api(path,method='GET',body){
 let draftId=null,draftFailed=false;
 if(method==='PUT'&&['records','dre'].includes(path)){
  try{draftId=await rememberDraft(path,body);}catch{draftFailed=true;}
  sendState('saving',{scope:path});
 }
 let response,data;
 try{
  response=await fetch('/api/'+path,{method,credentials:'same-origin',headers:body!==undefined?{'Content-Type':'application/json'}:{},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
  data=await response.json();
  if(!response.ok){const error=Error(data.error||'Não foi possível concluir.');error.status=response.status;error.code=data.code;error.retryAfter=data.retryAfter;if(/^[a-f0-9]{16}$/.test(data.requestId||''))error.requestId=data.requestId;throw error;}
 }catch(cause){
  if(method==='PUT'&&['records','dre'].includes(path))sendState('pending',{scope:path,localSaved:!!draftId,localFailed:draftFailed,conflict:cause.status===409});
  if(!cause.status&&method==='PUT'&&['records','dre'].includes(path)){pendingReports.push({code:'SAVE_CONNECTION_FAILED',feature:path==='dre'?'dre':'cash'});if(pendingReports.length>10)pendingReports.shift();void reportConnectionFailures();}
  if(cause.status)throw cause;
  const error=Error(draftId?'A conexão falhou. Um rascunho protegido foi mantido neste aparelho. Abra Minha conta para tentar novamente.':'A conexão falhou. Mantenha esta página aberta e tente novamente; a alteração ainda não foi confirmada.');error.code='CONNECTION_FAILED';throw error;
 }
 void reportConnectionFailures();
 if(path==='me')await setDraftIdentity(data);
 if(path==='logout')await setDraftIdentity(null);
 if(draftId){acknowledgeDraft(path,draftId);sendState('saved',{scope:path,at:Date.now()});}
 else if(method==='PUT'&&['records','dre'].includes(path))sendState('saved',{scope:path,at:Date.now()});
 return data;
}
// Remove apenas o armazenamento de tokens da versão anterior. Não remove lançamentos.
try{localStorage.removeItem('caixa-claro-supabase-session');}catch{}
