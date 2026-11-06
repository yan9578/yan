import {api} from './api.js';
import {pendingDrafts,discardDraft,acknowledgeDraft} from './drafts.js';
import {reviewConsent} from './telemetry.js';
let user=null,busy=false;
const $=s=>document.querySelector(s),scopeName=s=>s==='dre'?'DRE':'Fluxo de caixa';
const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value);
function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function retryDraft(d){
 const latest=await api(d.scope),field=d.scope==='dre'?'document':'records';
 if(latest.revision>d.payload.revision&&canonical(latest[field])===canonical(d.payload[field])){acknowledgeDraft(d.scope,d.id);return;}
 await api(d.scope,'PUT',d.payload);
}
async function renderDrafts(){
 const area=$('#account-drafts');area.replaceChildren();const drafts=await pendingDrafts();
 if(!drafts.length){area.textContent='Nenhuma alteração pendente neste aparelho.';return;}
 for(const d of drafts){const card=document.createElement('div');card.className='draft-item';const title=document.createElement('strong');title.textContent=scopeName(d.scope);const info=document.createElement('p');info.textContent=d.unreadable?'Este rascunho não pôde ser aberto com a chave atual. Contate o responsável antes de descartá-lo.':'Pendente desde '+new Date(d.updatedAt).toLocaleString('pt-BR');card.append(title,info);
  if(!d.unreadable){const retry=document.createElement('button');retry.className='secondary';retry.textContent='Tentar salvar';retry.onclick=async()=>{retry.disabled=true;try{await retryDraft(d);$('#account-feedback').textContent='Alteração confirmada no servidor. Recarregue para atualizar os relatórios.';await renderDrafts();}catch(e){$('#account-feedback').textContent=e.message;}finally{retry.disabled=false;}};const exportButton=document.createElement('button');exportButton.className='text-button';exportButton.textContent='Baixar rascunho';exportButton.onclick=()=>download(d.payload,'caixa-claro-rascunho-'+d.scope+'.json');card.append(retry,exportButton);}
  const discard=document.createElement('button');discard.className='text-button';discard.textContent='Descartar';discard.onclick=async()=>{if(confirm('Descartar este rascunho pendente deste aparelho?')){discardDraft(d.scope);await renderDrafts();}};card.append(discard);area.append(card);
 }
}
export function setAccount(value){user=value;$('#account-email').textContent=value.email||value.username;$('#account-session').textContent=value.remember?'Você escolheu manter esta sessão conectada neste aparelho.':'Sessão do navegador, com prazo de segurança. Use Sair em aparelhos compartilhados.';}
export function initAccount(){
 $('#account-open').onclick=async()=>{$('#account-feedback').textContent='';$('#account-dialog').showModal();await renderDrafts();};$('#account-close').onclick=()=>$('#account-dialog').close();
 $('#review-analytics').onclick=()=>{$('#account-dialog').close();reviewConsent();};
 $('#account-export').onclick=async e=>{e.target.disabled=true;try{download(await api('account/export'),'caixa-claro-meus-dados.json');$('#account-feedback').textContent='Seus dados foram exportados.';}catch(err){$('#account-feedback').textContent=err.message;}finally{e.target.disabled=false;}};
 $('#account-delete').onclick=async e=>{if(!confirm('Enviar uma solicitação para excluir sua conta e seus dados? Ela será analisada pelo responsável.'))return;e.target.disabled=true;try{const result=await api('account/deletion','POST',{});$('#account-feedback').textContent='Solicitação registrada. Situação: '+({pending:'aguardando análise',retained:'em análise de retenção',processing:'em processamento',completed:'concluída'}[result.status]||result.status);}catch(err){$('#account-feedback').textContent=err.message;}finally{e.target.disabled=false;}};
 window.addEventListener('caixa:save-state',e=>{const d=e.detail,area=$('#save-status');area.dataset.state=d.state;area.textContent=d.state==='saving'?'Salvando alteração…':d.state==='saved'?'Salvo no servidor às '+new Date(d.at).toLocaleTimeString('pt-BR'):d.localSaved?'Alteração pendente no servidor · rascunho protegido neste aparelho. Abra Minha conta.':'Alteração não confirmada · mantenha a página aberta e tente novamente.';});
 window.addEventListener('online',async()=>{if(!user||busy)return;busy=true;let success=false;try{for(const d of await pendingDrafts()){if(d.unreadable)continue;try{await retryDraft(d);success=true;}catch{}}if(success){$('#save-status').textContent='Conexão restabelecida. Alterações pendentes confirmadas; recarregue os relatórios.';await renderDrafts();}}finally{busy=false;}});
}
export async function showPendingNotice(){const drafts=await pendingDrafts();$('#save-status').textContent=drafts.length?'Há alterações pendentes neste aparelho. Abra Minha conta para conferir e tentar salvar.':'Dados carregados da sua conta.';$('#save-status').dataset.state=drafts.length?'pending':'saved';}
