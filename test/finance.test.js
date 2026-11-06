import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cents,summarize,csv} from '../public/finance.js';
test('valores monetários sem erros de ponto flutuante',()=>{assert.equal(cents('12,35'),1235);assert.equal(cents('0.01'),1);for(const v of ['0','-2','1,234','abc','Infinity'])assert.throws(()=>cents(v));});
const rows=[{date:'2026-10-01',type:'income',amount:10000,method:'Pix',description:'Venda',category:'Vendas'},{date:'2026-10-01',type:'income',amount:2000,method:'Dinheiro',description:'Venda',category:'Vendas'},{date:'2026-10-02',type:'expense',amount:5000,method:'Débito',description:'Compra',category:'Fornecedores'}];
test('totais, agrupamento diário, maiores dias e formas de pagamento',()=>{const s=summarize(rows);assert.equal(s.income,12000);assert.equal(s.expense,5000);assert.equal(s.balance,7000);assert.equal(s.bestIncome[0],'2026-10-01');assert.equal(s.bestIncome[1].income,12000);assert.equal(s.bestExpense[0],'2026-10-02');assert.equal(s.payments.Pix,10000);assert.equal(s.payments.Débito,0);});
test('caixa vazio não inventa destaques',()=>{const s=summarize([]);assert.equal(s.balance,0);assert.equal(s.bestIncome,undefined);});
test('CSV preserva centavos, acentos e neutraliza fórmulas',()=>{const out=csv([{...rows[0],description:'=SUM(A1)";teste'}]);assert.ok(out.startsWith('\uFEFF'));assert.ok(out.includes('100,00'));assert.ok(out.includes('"\'=SUM(A1)"";teste"'));});
