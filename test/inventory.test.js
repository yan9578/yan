import assert from 'node:assert/strict';
import {test} from 'node:test';
import {M} from '../public/dre-model.js';
import {applyCommand,cashOperations,dreOperations,emptyOperations,project,remaining} from '../public/operations-model.js';
import {inventoryBook,inventorySummary,pendingClosures,projectInventoryReport} from '../public/inventory-model.js';

const companies=[{id:'store',name:'Loja',sector:''},{id:'other',name:'Outra empresa',sector:''}];
const book={version:1,companies,entries:[]};
const today='2026-12-05';
const context={companies,entries:[],today,now:'2026-12-05T15:00:00Z',cmvPreview:true};
const run=(state,command,entries=[])=>applyCommand(state,{company:'store',...command},{...context,entries});
const acquisition={id:'note',action:'save-operation',category:'inventory',description:'Mercadoria',amount:1_000_000,date:'2026-11-20',
 due:'2026-12-10',purchaseReference:'NF 001'};
const payment={action:'settle',id:'note',paymentId:'payment-1',amount:400_000,date:'2026-12-05',account:'caixa-geral',method:'Pix'};
const close=(state,month,opening,ending,entries)=>run(state,{action:'save-cmv',month,opening,ending},entries);
const statement=(state,original=book,month='2026-11')=>M.report(projectInventoryReport(state,original,dreOperations(state,original,true)),'store',month);

test('compra por aquisição, caixa por baixa e CMV por fechamento sem duplicação',()=>{
 let state=run(emptyOperations(),acquisition);
 assert.equal(cashOperations(state).length,0);
 assert.equal(project(state,'store',[],today,7).closing,-1_000_000);
 assert.throws(()=>run(state,{...acquisition,id:'second',purchaseReference:'nf 001'}),/referência/);
 state=run(state,{...acquisition,id:'cash-note',amount:200_000,purchaseReference:'NF 002',settlement:{
  paymentId:'cash-payment',date:'2026-11-22',account:'caixa-geral',method:'Pix'
 }});
 assert.equal(remaining(state.operations[1]),0);
 state=run(state,payment);
 assert.throws(()=>run(state,payment),/já foi registrada/);
 assert.deepEqual(cashOperations(state).map(row=>[row.date,row.amount]),[['2026-12-05',400_000],['2026-11-22',200_000]]);
 assert.equal(remaining(state.operations[0]),600_000);
 assert.equal(inventorySummary(state,book,'store','2026-11').purchases,1_200_000);
 state=run(state,{...payment,paymentId:'payment-2',amount:600_000});
 assert.equal(remaining(state.operations[0]),0);
 assert.equal(inventorySummary(state,book,'store','2026-11').purchases,1_200_000);
 assert.equal(inventorySummary(state,book,'store','2026-12').purchases,0);
 assert.equal(statement(state).cost,0);
 for(const [kind,amount] of [['freight',30_000],['returns',50_000],['tax',80_000],['loss',25_000]]){
  state=run(state,{action:'save-stock-adjustment',month:'2026-11',id:kind,kind,amount,description:'Documento '+kind});
 }
 assert.throws(()=>run(state,{action:'save-stock-adjustment',month:'2026-11',id:'freight-copy',kind:'freight',amount:30_000,description:'Documento freight'}),/já existe/i);
 state=close(state,'2026-11',400_000,null);
 assert.equal(statement(state).cost,0);
 assert.equal(pendingClosures(state,book,'store','2026-11',false).length,1);
 assert.throws(()=>close(state,'2026-11',400_000,-1),/valor válido/);
 assert.throws(()=>close(state,'2026-11',400_000,1_600_000),/supera/);
 state=close(state,'2026-11',400_000,900_000);
 const month=inventorySummary(state,book,'store','2026-11');
 assert.equal(month.net,1_100_000);
 assert.equal(month.losses,25_000);
 assert.equal(month.cmv,600_000);
 assert.equal(statement(state).cost,600_000);
 assert.equal(statement(state).detail.monthlyCmv,600_000);
 state=close(state,'2026-12',null,750_000);
 assert.equal(inventorySummary(state,book,'store','2026-12').opening,900_000);
 assert.equal(statement(state,book,'2026-12').cost,150_000);
 assert.deepEqual(pendingClosures(state,book,'store','2026-12',true),[]);
 state=close(state,'2026-11',400_000,850_000);
 assert.equal(statement(state,book,'2026-12').cost,100_000);
 state=run(state,{action:'delete-stock-adjustment',month:'2026-11',id:'freight'});
 assert.equal(inventorySummary(state,book,'store','2026-11').net,1_070_000);
});

test('revisão explícita preserva originais e não recria pagamentos',()=>{
 const raw={id:'legacy',company:'store',description:'Aquisição antiga',category:'cost',date:'2026-11-01',amount:100_000};
 const original={...book,entries:[raw,{...raw,id:'cost',description:'Serviço direto',amount:20_000},{...raw,id:'copy'}]};
 let state=close(emptyOperations(),'2026-11',0,0,original.entries);
 assert.equal(inventorySummary(state,original,'store','2026-11').cmv,null);
 assert.equal(statement(state,original).cost,0);
 const review=(state,row,decision)=>run(state,{action:'review-stock-legacy',month:'2026-11',id:row.id,
  source:'dre',sourceDate:row.date,sourceAmount:row.amount,sourceCategory:row.category,decision},original.entries);
 state=review(state,raw,'purchase');
 state=review(state,original.entries[1],'service');
 state=review(state,original.entries[2],'covered');
 assert.equal(statement(state,original).detail.monthlyCmv,100_000);
 assert.equal(statement(state,original).detail.serviceCost,20_000);
 assert.equal(statement(state,original).cost,120_000);
 assert.equal(raw.category,'cost');
 assert.equal(cashOperations(state).length,0);
 assert.throws(()=>review(state,{...raw,amount:12},'purchase'),/mudou/);
 assert.equal(inventoryBook(state).reviews.length,3);
 state=review(state,raw,'undo');
 assert.equal(inventorySummary(state,original,'store','2026-11').cmv,null);
});
