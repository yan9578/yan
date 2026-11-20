import {M} from './dre-model.js';
import {methods} from './finance.js';

export const types = Object.freeze({
  sales: 'income', services: 'income', deductions: 'expense', cost: 'expense',
  personnel: 'expense', admin: 'expense', commercial: 'expense', structure: 'expense',
  otherExpense: 'expense', otherIncome: 'income', financialIncome: 'income',
  financialExpense: 'expense', taxes: 'expense', capital: 'income', loan: 'income',
  principal: 'expense', assets: 'expense', inventory: 'expense', distribution: 'expense'
});
export const defaultAccount = 'caixa-geral';
export const defaultAccounts = () => [{id:defaultAccount, name:'Caixa geral', opening:0, date:''}];
export const emptyOperations = () => ({operations:[], profiles:[], transfers:[], audit:[]});
export const money = cents => ((cents || 0) / 100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export const isoDay = (date = new Date()) =>
  [date.getFullYear(), date.getMonth()+1, date.getDate()].map(n=>String(n).padStart(2,'0')).join('-');
export function addDays(day, days) {
  const date = new Date(day+'T12:00:00');
  date.setDate(date.getDate()+days);
  return isoDay(date);
}
export const currentProfile = (state, company) =>
  state.profiles.find(p=>p.company===company) ?? {company, accounts:defaultAccounts(), categories:[], alertDays:7};
export function categoryUsage(state, company, id) {
  const counts = new Map();
  for (const operation of state.operations) {
    if (operation.company!==company||operation.categoryId!==id) continue;
    counts.set(operation.category,(counts.get(operation.category)??0)+1);
  }
  return counts;
}
export const paid = operation => operation.payments.filter(p=>!p.reversed).reduce((sum,p)=>sum+p.amount,0);
export const remaining = operation => operation.cancelled ? 0 : operation.amount-paid(operation);
export function situation(operation, today) {
  const open = remaining(operation);
  if (operation.cancelled) return 'cancelled';
  if (!open) return 'paid';
  if (operation.due < today) return 'late';
  return open === operation.amount ? 'pending' : 'partial';
}
export function cashOperations(state) {
  return state.operations.filter(o=>!o.cancelled).flatMap(o=>o.payments.filter(p=>!p.reversed).map(p=>({
    id:'baixa-'+p.id, company:o.company, type:o.type, account:p.account,
    date:p.date, saleDate:['sales','services'].includes(o.category)&&o.date<=p.date?o.date:'',
    category:o.categoryName, description:o.description, amount:p.amount, method:p.method, linked:true
  })));
}
export function dreOperations(state, book) {
  const ids = new Set(book.companies.map(c=>c.id));
  return state.operations.filter(o=>!o.cancelled&&ids.has(o.company)).map(o=>({
    id:'operacao-'+o.id, company:o.company, date:o.date, category:o.category,
    description:o.description, amount:o.amount, linked:true
  }));
}
function accountMovements(rows, transfers, account) {
  return [
    ...rows.filter(r=>(r.account || defaultAccount)===account).map(r=>({date:r.date, value:r.type==='income'?r.amount:-r.amount})),
    ...transfers.filter(t=>t.to===account||t.from===account).map(t=>({date:t.date,value:t.to===account?t.amount:-t.amount}))
  ];
}
function accountBefore(movements, account, before) {
  const sumBefore = day => movements.reduce((sum,m)=>sum+(!day||m.date<day?m.value:0),0);
  return account.opening+(before?sumBefore(before):0)-(account.date?sumBefore(account.date):0);
}
export function cashBalances(state, company, rows, from, to) {
  const accounts = currentProfile(state,company).accounts;
  const transfers = state.transfers.filter(t=>t.company===company);
  return accounts.map(account=>{
    const movements = accountMovements(rows,transfers,account.id);
    const opening = accountBefore(movements,account,from);
    const closing = to ? accountBefore(movements,account,addDays(to,1))
      : account.opening + movements.reduce((sum,m)=>sum+m.value,0)
        - (account.date?movements.filter(m=>m.date<account.date).reduce((sum,m)=>sum+m.value,0):0);
    return {...account,opening,closing};
  });
}
export function project(state, company, rows, today, days) {
  const opening = cashBalances(state,company,rows,today,today).reduce((sum,a)=>sum+a.closing,0);
  const end = addDays(today,days);
  const amounts = new Map();
  for (const o of state.operations) {
    const open = remaining(o);
    if (o.company!==company||!open||o.due>end) continue;
    const day = o.due<today?today:o.due;
    const totals = amounts.get(day) ?? {income:0,expense:0};
    totals[o.type]+=open;
    amounts.set(day,totals);
  }
  let balance = opening;
  const events = [...amounts].sort(([a],[b])=>a.localeCompare(b)).map(([date,{income,expense}])=>{
    balance += income-expense;
    return {date,income,expense,balance};
  });
  return {opening, closing:balance, events, shortage:opening<0?today:events.find(e=>e.balance<0)?.date};
}
function check(ok, message) {
  if (!ok) throw Error(message);
}
function textValue(value, max, label) {
  const text = typeof value==='string'?value.trim():'';
  check(text&&text.length<=max,label);
  return text;
}
function amount(value, allowNegative = false) {
  check(Number.isSafeInteger(value)&&value<=(1e12)&&value>=(allowNegative?-1e12:1),'Informe um valor válido.');
  return value;
}
function dateValue(value, label, max) {
  check(M.dateValid(value)&&(!max||value<=max),label);
  return value;
}
function idValue(value) {
  check(typeof value==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(value),'Identificador inválido.');
  return value;
}
export function applyCommand(state, command, {companies, today, now}) {
  check(command&&typeof command==='object','Operação inválida.');
  const {action, company, id} = command;
  check(companies.some(c=>c.id===company),'Selecione uma empresa cadastrada.');
  const next = structuredClone(state);
  const profile = currentProfile(next,company);
  const findAccount = id => profile.accounts.find(a=>a.id===id);
  let operation = next.operations.find(o=>o.id===id&&o.company===company);
  let details;
  switch (action) {
    case 'save-operation': {
      idValue(id);
      check(operation||!next.operations.some(o=>o.id===id),'Identificador já utilizado.');
      check(operation?!operation.cancelled:next.operations.length<5000,'Operação cancelada ou limite atingido.');
      const value = amount(command.amount);
      const date = dateValue(command.date,'Informe uma data da operação válida, até hoje.',today);
      const due = dateValue(command.due,'Informe um vencimento válido.');
      check(due>=date,'O vencimento precisa ser na data da operação ou depois.');
      const sameCategory = operation&&operation.categoryId===command.category;
      const custom = sameCategory?{category:operation.category,name:operation.categoryName}:profile.categories.find(c=>c.id===command.category);
      const category = custom?.category||command.category;
      check(Object.hasOwn(types,category)&&Object.hasOwn(M.map,category),'Selecione uma categoria válida.');
      const type = types[category];
      const description = textValue(command.description,120,'Informe uma descrição de até 120 caracteres.');
      const payments = operation?.payments||[];
      if (operation&&payments.some(p=>!p.reversed)) {
        check(transactionUnchanged(operation,{value,date,category,type}), 'Estorne as baixas antes de alterar valor, data ou classificação.');
      }
      details = operation ? {before:{...operation,payments:undefined}} : undefined;
      const update = {id,company,amount:value,date,due,category,categoryId:command.category,
        categoryName:custom?.name||M.map[category].name,type,description,payments};
      if (operation) Object.assign(operation,update);
      else next.operations.push(update);
      break;
    }
    case 'settle': {
      check(operation&&remaining(operation)>0,'Esta conta não tem saldo em aberto.');
      idValue(command.paymentId);
      check(!next.operations.some(o=>o.payments.some(p=>p.id===command.paymentId)),'Esta baixa já foi registrada.');
      const value = amount(command.amount);
      check(value<=remaining(operation),'O valor excede o saldo em aberto.');
      const day = dateValue(command.date,'Informe uma data de pagamento válida, até hoje.',today);
      check(findAccount(command.account)&&methods.includes(command.method),'Selecione a conta e a forma de pagamento.');
      check(operation.payments.length<1000,'Limite de baixas atingido.');
      operation.payments.push({id:command.paymentId, amount:value, date:day, account:command.account, method:command.method});
      details = {payment:command.paymentId, amount:value};
      break;
    }
    case 'reverse': {
      const payment = operation?.payments.find(p=>p.id===command.paymentId&&!p.reversed);
      check(payment&&!operation.cancelled,'Baixa já estornada ou indisponível.');
      payment.reversed = now;
      details = {payment:payment.id, amount:payment.amount};
      break;
    }
    case 'cancel':
      check(operation&&!operation.cancelled&&paid(operation)===0,'Estorne as baixas antes de cancelar esta operação.');
      operation.cancelled = now;
      break;
    case 'save-account': {
      idValue(id);
      const existing = findAccount(id);
      const name = textValue(command.name,60,'Informe o nome da conta.');
      check(!profile.accounts.some(a=>a.id!==id&&a.name.toLowerCase()===name.toLowerCase()),'Já existe uma conta com esse nome.');
      const opening = amount(command.opening,true);
      const date = command.date ? dateValue(command.date,'Informe a data do saldo inicial, até hoje.',today) : '';
      check(existing||profile.accounts.length<40,'Limite de contas atingido.');
      details = existing ? {before:{...existing}} : undefined;
      const update = {id,name,opening,date};
      if (existing) Object.assign(existing,update);
      else profile.accounts.push(update);
      break;
    }
    case 'save-category': {
      idValue(id);
      check(!Object.hasOwn(types,id),'Esse identificador pertence a uma categoria padrão.');
      const existing = profile.categories.find(c=>c.id===id);
      const name = textValue(command.name,60,'Informe um nome de categoria.');
      check(Object.hasOwn(types,command.category),'Selecione uma classificação financeira.');
      check(!profile.categories.some(c=>c.id!==id&&c.name.toLowerCase()===name.toLowerCase()),'Já existe uma categoria com esse nome.');
      check(existing||profile.categories.length<80,'Limite de categorias atingido.');
      const update = {id,name,category:command.category};
      if (existing) {
        details = {before:{...existing}};
        Object.assign(existing,update);
        for (const linked of next.operations) {
          if (linked.company===company&&linked.categoryId===id) linked.categoryName=name;
        }
      } else profile.categories.push(update);
      break;
    }
    case 'delete-category': {
      const index = profile.categories.findIndex(c=>c.id===id);
      check(index>=0,'Categoria personalizada indisponível.');
      const usage = categoryUsage(next,company,id);
      const replacements = new Map();
      for (const [classification,count] of usage) {
        const destination = command.destinations?.[classification];
        const custom = profile.categories.find(c=>c.id===destination);
        check(destination&&destination!==id&&(destination===classification||custom?.category===classification),
          'Escolha um destino que mantenha a classificação de cada movimentação.');
        replacements.set(classification,{id:destination,name:custom?.name||M.map[classification].name,count});
      }
      for (const linked of next.operations) {
        if (linked.company!==company||linked.categoryId!==id) continue;
        const replacement = replacements.get(linked.category);
        linked.categoryId=replacement.id;
        linked.categoryName=replacement.name;
      }
      const [deleted] = profile.categories.splice(index,1);
      details = {before:deleted, destinations:Object.fromEntries(replacements)};
      break;
    }
    case 'preferences':
      check([0,3,7,15,30].includes(command.alertDays),'Prazo de alerta inválido.');
      profile.alertDays = command.alertDays;
      break;
    case 'transfer': {
      idValue(id);
      check(!next.transfers.some(t=>t.id===id)&&next.transfers.length<5000,'Transferência duplicada ou limite atingido.');
      check(command.from!==command.to&&findAccount(command.from)&&findAccount(command.to),'Selecione duas contas diferentes.');
      const day = dateValue(command.date,'Informe uma data de transferência válida, até hoje.',today);
      const value = amount(command.amount);
      next.transfers.push({id,company,from:command.from,to:command.to,date:day,amount:value});
      break;
    }
    case 'reverse-transfer': {
      const index = next.transfers.findIndex(t=>t.id===id&&t.company===company);
      check(index>=0,'Transferência indisponível.');
      details = {before:next.transfers[index]};
      next.transfers.splice(index,1);
      break;
    }
    default:
      throw Error('Ação desconhecida.');
  }
  if (!next.profiles.some(p=>p.company===company)) next.profiles.push(profile);
  next.audit.push({action, company, id:id||'', at:now, ...(details?{details}:{})});
  return next;
}

function transactionUnchanged(operation, {value,date,category,type}) {
  return operation.amount===value&&operation.date===date&&operation.category===category&&operation.type===type;
}
