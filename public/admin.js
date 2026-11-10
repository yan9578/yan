import {api} from './api.js';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>typeof v==='number'?v.toLocaleString('pt-BR'):'—',mb=n=>typeof n==='number'?(n/1024/1024).toLocaleString('pt-BR',{maximumFractionDigits:1})+' MB':'Não disponível';
const labels={cash:'Fluxo de caixa',dre:'DRE',account:'Conta e autenticação',admin:'Administração'};let loading=false;
export async function loadAdmin(){
 if(loading)return;loading=true;$('#admin-error').textContent='Carregando indicadores…';
 try{
  const days=$('#admin-period').value,[m,requests]=await Promise.all([api('admin/metrics?days='+days),api('admin/requests')]);
  const cards=[['Contas existentes',m.totalUsers],['E-mails confirmados',m.confirmedUsers],['Novas contas hoje',m.newToday],['Novas contas · 7 dias',m.new7Days],['Novas contas · 30 dias',m.new30Days],['Ativos hoje',m.dailyActive],['Ativos · 30 dias',m.monthlyActive],['Usuários que retornaram',m.returningUsers],['Visitas autorizadas',m.visits],['Visitantes aproximados',m.uniqueVisitors],['Erros observados',m.errors],['Falhas ao salvar',m.saveFailures]];
  $('#admin-cards').innerHTML=cards.map(([label,value])=>`<article><small>${esc(label)}</small><strong>${number(value)}</strong></article>`).join('');
  const max=Math.max(1,...m.daily.flatMap(d=>[d.registrations,d.active,d.visits]));
  $('#admin-chart').innerHTML='<div class="admin-legend"><span>● Cadastros</span><span>● Ativos</span><span>● Visitas</span></div><div class="admin-bars">'+m.daily.map(d=>`<div class="admin-day" title="${esc(d.day)}: ${d.registrations} cadastros, ${d.active} ativos, ${d.visits} visitas"><div>${['registrations','active','visits'].map((key,i)=>`<i class="series-${i}" style="height:${Math.max(0,Number(d[key]))/max*140}px"></i>`).join('')}</div><small>${esc(d.day.slice(8))}/${esc(d.day.slice(5,7))}</small></div>`).join('')+'</div>';
  $('#admin-features').innerHTML=m.features.length?m.features.map(f=>`<p class="resource-row"><span>${esc(labels[f.feature]||'Outra área')}</span><strong>${number(f.visits)}</strong></p>`).join(''):'<p>Nenhum uso de funcionalidade registrado no período.</p>';
  const resources=$('#admin-resources');resources.innerHTML=`<p class="resource-row"><span>Banco completo</span><strong>${mb(m.databaseBytes)}</strong></p><p class="resource-row"><span>Tabelas financeiras e índices</span><strong>${mb(m.financialBytes)}</strong></p><p class="resource-row"><span>Limite informado do plano</span><strong>${m.databaseLimitMb?number(m.databaseLimitMb)+' MB':'Não configurado'}</strong></p>`;
  const h=m.hosting;const host=document.createElement('p');host.textContent=h?.available?`Netlify · equipe: ${number(h.buildMinutes)} minutos de build usados; franquia informada: ${number(h.includedMinutes)} minutos.`:h?.configured?'Não foi possível consultar o uso da hospedagem agora.':'A consulta ao uso do Netlify ainda não foi configurada.';resources.append(host);
  if(m.hostingDashboard){try{const u=new URL(m.hostingDashboard);if(u.protocol==='https:'&&u.hostname==='app.netlify.com'){const link=document.createElement('a');link.href=u.href;link.target='_blank';link.rel='noopener';link.textContent='Abrir uso e limites no Netlify';resources.append(link);}}catch{}}
  const backup=document.createElement('p');backup.textContent=m.lastExternalBackup?'Última cópia externa confirmada: '+new Date(m.lastExternalBackup).toLocaleString('pt-BR')+' · Falhas de backup na semana: '+number(m.recentBackupFailures):'Nenhuma cópia externa confirmada. Configure e verifique a rotina de backup.';resources.append(backup);
  if(m.configuration){const status=document.createElement('p');status.className='hint';status.textContent='Google no aplicativo: '+(m.configuration.googleAuth?'habilitado':'desativado')+' · Códigos por e-mail: '+(m.configuration.emailCodesEnabled===false?'desativados':m.configuration.publicAuth?'habilitados':'bloqueados')+' · E-mail: '+(m.configuration.emailCodesEnabled===false?'não utilizado no acesso Google':m.configuration.emailReady?'configuração informada':'pendente')+' · Backup externo: '+(m.configuration.backupReady?'configuração confirmada':'pendente');resources.append(status);}
  renderRequests(requests);$('#admin-error').textContent='Atualizado às '+new Date().toLocaleTimeString('pt-BR');
 }catch(err){$('#admin-error').textContent=err.message;}finally{loading=false;}
}
function renderRequests(rows){const area=$('#admin-requests');area.replaceChildren();if(!rows.length){area.textContent='Nenhuma solicitação pendente.';return;}
 for(const r of rows){const item=document.createElement('div');item.className='deletion-item';const text=document.createElement('p');text.textContent=(r.email||'Conta já removida')+' · '+new Date(r.requestedAt).toLocaleDateString('pt-BR')+' · '+r.status;item.append(text);
  const retain=document.createElement('button');retain.className='secondary';retain.textContent='Manter em análise de retenção';retain.onclick=()=>resolve(r,'retain');const remove=document.createElement('button');remove.className='danger-button';remove.textContent=r.userId?'Concluir exclusão':'Finalizar solicitação';remove.onclick=()=>resolve(r,'delete');item.append(retain,remove);area.append(item);
 }
}
async function resolve(r,action){let confirmation='',noLegalRetention=false;if(action==='delete'){
 if(!confirm('Você avaliou as obrigações legais e confirmou que esta conta não precisa de retenção? A exclusão remove a conta e seus dados financeiros de forma irreversível.'))return;
 confirmation=prompt('Digite EXCLUIR para confirmar:')||'';if(confirmation!=='EXCLUIR')return;noLegalRetention=true;
 }
 try{await api('admin/deletion','POST',{id:r.id,action,confirmation,noLegalRetention});await loadAdmin();}catch(err){$('#admin-error').textContent=err.message;}
}
export function initAdmin(){$('#admin-period').onchange=loadAdmin;}
