import {test} from 'node:test';
import assert from 'node:assert/strict';
import {M} from '../public/dre-model.js';
import {cents,csv,summarize} from '../public/finance.js';
import {addDays,applyCommand,cashBalances,cashOperations,categoryUsage,dreOperations,emptyOperations,project,remaining,situation} from '../public/operations-model.js';

const companies=[{id:'loja',name:'Loja',sector:''},{id:'filial',name:'Filial',sector:''}];
const env={companies,today:'2026-12-07',now:'2026-12-07T12:00:00Z'};
const run=(data,action,fields)=>applyCommand(data,{action,company:'loja',...fields},env);
const sale={id:'sell',category:'sales',description:'Venda a prazo',amount:1_000_000,date:'2026-11-05',due:'2026-12-05'};
const first={id:'sell',paymentId:'one',date:'2026-12-05',amount:600_000,account:'caixa-geral',method:'Pix'};

test('uma venda com duas baixas é reconhecida uma vez na DRE e por parcela no caixa',()=>{
 let data=run(emptyOperations(),'save-operation',sale);
 assert.equal(cashOperations(data).length,0);
 data=run(data,'settle',first);
 assert.equal(remaining(data.operations[0]),400_000);
 assert.equal(situation(data.operations[0],'2026-12-05'),'partial');
 assert.equal(situation(data.operations[0],env.today),'late');
 assert.throws(()=>run(data,'settle',{...first,paymentId:'future',amount:1,date:'2026-12-08'}),/até hoje/);
 assert.throws(()=>run(data,'settle',first),/já foi registrada/);
 assert.throws(()=>run(data,'settle',{...first,paymentId:'excess',amount:400_001}),/excede/);
 assert.throws(()=>run(data,'save-operation',{...sale,amount:600_000}),/Estorne/);
 data=run(data,'settle',{...first,paymentId:'two',amount:400_000,date:'2026-12-07'});
 assert.equal(situation(data.operations[0],env.today),'paid');
 const book={companies,entries:dreOperations(data,{companies}),version:1};
 M.validate(book);
 assert.equal(M.report(book,'loja','2026-11').netRevenue,1_000_000);
 assert.equal(M.report(book,'loja','2026-12').netRevenue,0);
 assert.equal(summarize(cashOperations(data)).income,1_000_000);
 assert.equal(M.report(book,'filial','2026-11').netRevenue,0);
});

test('compra de estoque fica fora do resultado, com estorno rastreável e cancelamento',()=>{
 const purchase={...sale,id:'stock',category:'inventory',amount:150_000};
 let data=run(emptyOperations(),'save-operation',purchase);
 data=run(data,'settle',{...first,id:'stock',amount:150_000});
 const entries=dreOperations(data,{companies});
 const report=M.report({companies,entries},'loja','2026-11');
 assert.equal(report.profit,0);
 assert.equal(report.outsideCount,1);
 assert.equal(summarize(cashOperations(data)).expense,150_000);
 assert.throws(()=>run(data,'cancel',{id:'stock'}),/Estorne/);
 data=run(data,'reverse',{id:'stock',paymentId:'one'});
 assert.equal(data.operations[0].payments[0].reversed,env.now);
 assert.equal(cashOperations(data).length,0);
 data=run(data,'cancel',{id:'stock'});
 assert.equal(dreOperations(data,{companies}).length,0);
 assert.equal(data.audit.length,4);
});

test('saldo transportado e transferências sem receita, incluindo alerta previsto',()=>{
 let data=run(emptyOperations(),'save-account',{id:'caixa-geral',name:'Caixa',opening:50_000,date:'2026-11-01'});
 data=run(data,'save-account',{id:'banco',name:'Banco',opening:0,date:''});
 data=run(data,'transfer',{id:'tr',from:'caixa-geral',to:'banco',date:'2026-11-20',amount:10_000});
 const rows=[{date:'2026-11-10',type:'income',amount:20_000},{date:'2026-12-02',type:'expense',amount:5_000,account:'banco'}];
 const nov=cashBalances(data,'loja',rows,'2026-11-01','2026-11-30');
 const dec=cashBalances(data,'loja',rows,'2026-12-01','2026-12-31');
 assert.deepEqual(nov.map(a=>a.closing),[60_000,10_000]);
 assert.deepEqual(dec.map(a=>a.opening),nov.map(a=>a.closing));
 assert.deepEqual(dec.map(a=>a.closing),[60_000,5_000]);
 data=run(data,'save-operation',{...sale,id:'bill',category:'admin',amount:70_000,due:'2026-12-10'});
 const forecast=project(data,'loja',rows,env.today,7);
 assert.equal(forecast.opening,65_000);
 assert.equal(forecast.closing,-5_000);
 assert.equal(forecast.shortage,'2026-12-10');
});

test('formatos BRL aceitos e exportação preserva a data opcional',()=>{
 for(const value of ['1.200,50','1200,50','R$ 1.200,50'])assert.equal(cents(value),120_050);
 const base={date:'2026-12-05',description:'Aluguel',category:'Aluguel',method:'Pix',amount:5000};
 const out=csv([{...base,type:'expense',saleDate:'2026-12-05'},{...base,type:'income'},{...base,type:'income',saleDate:'2026-11-10'}]);
 assert.match(out,/"2026-12-05";"";"Aluguel";"Saída"/);
 assert.match(out,/"2026-12-05";"";"Aluguel";"Entrada"/);
 assert.match(out,/"2026-12-05";"2026-11-10";"Aluguel";"Entrada"/);
});

test('exclusão migra categorias por classificação sem alterar valores, baixas ou outra empresa',()=>{
 let data=run(emptyOperations(),'save-category',{id:'origem',name:'Vendas especiais',category:'sales'});
 data=run(data,'save-category',{id:'destino',name:'Vendas digitais',category:'sales'});
 data=run(data,'save-operation',{...sale,category:'origem'});
 data=run(data,'settle',first);
 data=run(data,'save-category',{id:'origem',name:'Parcerias',category:'services'});
 assert.equal(data.operations[0].categoryName,'Parcerias');
 assert.equal(data.operations[0].category,'sales');
 data=run(data,'save-operation',{...sale,id:'service',category:'origem'});
 data=applyCommand(data,{action:'save-category',id:'origem',name:'Filial',category:'sales',company:'filial'},env);
 assert.deepEqual([...categoryUsage(data,'loja','origem')],[['sales',1],['services',1]]);
 assert.throws(()=>run(data,'delete-category',{id:'origem'}),/Escolha um destino/);
 assert.throws(()=>run(data,'delete-category',{id:'origem',destinations:{sales:'inventory',services:'services'}}),/classificação/);
 assert.throws(()=>run(data,'delete-category',{id:'sales'}),/personalizada/);
 assert.equal(data.profiles[0].categories.length,2);
 const before=dreOperations(data,{companies});
 const payments=structuredClone(data.operations[0].payments);
 data=run(data,'delete-category',{id:'origem',destinations:{sales:'destino',services:'services'}});
 assert.deepEqual(dreOperations(data,{companies}),before);
 assert.deepEqual(data.operations[0].payments,payments);
 assert.equal(data.operations[0].categoryId,'destino');
 assert.equal(cashOperations(data)[0].category,'Vendas digitais');
 assert.equal(data.operations[1].categoryId,'services');
 assert.equal(data.profiles[1].categories[0].id,'origem');
 assert.equal(data.audit.at(-1).details.destinations.sales.count,1);
 data=run(data,'save-category',{id:'vazia',name:'Sem uso',category:'admin'});
 data=run(data,'delete-category',{id:'vazia',destinations:{}});
 assert.equal(data.profiles[0].categories.some(c=>c.id==='vazia'),false);
});

test('projeção inclui o último dia de cada horizonte, reflete a baixa parcial e exclui o dia seguinte',()=>{
 let data=run(emptyOperations(),'save-account',{id:'caixa-geral',name:'Caixa geral',opening:10_000,date:''});
 for(const [id,category,value,days] of [
  ['short','sales',3_000,7],['middle','admin',20_000,15],['long','services',12_000,30],['later','sales',100_000,31]
 ]){
  data=run(data,'save-operation',{...sale,id,category,amount:value,due:addDays(env.today,days)});
 }
 data=run(data,'settle',{...first,id:'short',amount:1_000,date:env.today});
 const rows=cashOperations(data);
 assert.deepEqual([7,15,30].map(days=>project(data,'loja',rows,env.today,days).closing),[13_000,-7_000,5_000]);
 assert.equal(project(data,'loja',rows,env.today,15).shortage,addDays(env.today,15));
 assert.equal(rows.length,1);
});
