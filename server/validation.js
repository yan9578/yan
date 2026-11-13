import {M} from '../public/dre-model.js';
import {validateCashCompany} from '../public/cash-model.js';
export function email(value){const e=String(value||'').trim().toLowerCase();if(e.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(e))throw Error('Informe um e-mail válido.');return e;}
export function password(value){if(typeof value!=='string'||value.length<10||value.length>128||!/[A-Za-z]/.test(value)||!/[0-9]/.test(value))throw Error('Use de 10 a 128 caracteres, incluindo letras e números.');return value;}
export function validateRecords(rows){
 if(!Array.isArray(rows)||rows.length>5000)throw Error('Lançamentos inválidos.');
 const ids=new Set();return rows.map(r=>{
  if(!r||typeof r.id!=='string'||!/^[A-Za-z0-9-]{1,80}$/.test(r.id)||ids.has(r.id)||!['income','expense'].includes(r.type)||!['Pix','Dinheiro','Débito','Crédito'].includes(r.method)||!Number.isSafeInteger(r.amount)||r.amount<1||r.amount>1e12||typeof r.description!=='string'||!r.description.trim()||r.description.length>120||typeof r.category!=='string'||r.category.length>60||!M.dateValid(r.date)||(r.saleDate&&(!M.dateValid(r.saleDate)||r.saleDate>r.date)))throw Error('Lançamento inválido.');
  ids.add(r.id);return {...Object.fromEntries(['id','type','method','amount','description','category','date','saleDate'].map(k=>[k,r[k]??''])),...validateCashCompany(r)};
 });
}
export function validateDre(doc){M.validate(doc);return {version:1,companies:doc.companies.map(c=>({id:c.id,name:c.name,sector:c.sector})),entries:doc.entries.map(e=>Object.fromEntries(['id','company','date','description','category','amount'].map(k=>[k,e[k]])))};}
export function revision(n){if(!Number.isSafeInteger(n)||n<0)throw Error('Versão inválida.');return n;}
