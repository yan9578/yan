export const methods=['Pix','Dinheiro','Débito','Crédito'];
export function cents(value, {signed=false}={}) {
 const text=String(value).trim().replace(/^R\$\s*/,'');
 const negative=text.startsWith('-');
 let number=negative&&signed?text.slice(1).trim():text;
 if(/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(number)){
  number=number.replaceAll('.','').replace(',','.');
 }else if(!/^\d+\.\d{1,2}$/.test(number)){
  throw Error('Informe um valor válido, como 1.200,50.');
 }
 const [whole,decimal='']=number.split('.');
 const n=Number(whole)*100+Number(decimal.padEnd(2,'0'));
 if(!Number.isSafeInteger(n)||n>1e12||(!signed&&n===0))
  throw Error('Informe um valor dentro do limite de R$ 10 bilhões.');
 return negative&&n?-n:n;
}
export function summarize(rows){const daily={};let income=0,expense=0;const payments=Object.fromEntries(methods.map(m=>[m,0]));for(const r of rows){daily[r.date]??={income:0,expense:0};daily[r.date][r.type]+=r.amount;if(r.type==='income'){income+=r.amount;payments[r.method]+=r.amount;}else expense+=r.amount;}const best=key=>Object.entries(daily).filter(([,v])=>v[key]>0).sort((a,b)=>b[1][key]-a[1][key]||a[0].localeCompare(b[0]))[0];return {income,expense,balance:income-expense,daily,payments,bestIncome:best('income'),bestExpense:best('expense')};}
export function csv(rows){const cell=v=>'"'+String(v).replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';return '\uFEFF'+[['Data do caixa','Data da venda','Descrição','Tipo','Categoria','Forma de pagamento','Valor líquido (R$)'],...rows.map(r=>[r.date,r.type==='income'?r.saleDate||'':'',r.description,r.type==='income'?'Entrada':'Saída',r.category,r.method,(r.amount/100).toFixed(2).replace('.',',')])].map(r=>r.map(cell).join(';')).join('\r\n');}
