// O identificador é o mesmo do cadastro da DRE. Lançamentos antigos não
// recebem uma empresa por suposição; permanecem no grupo de identificação.
export const recordCompany=record=>record.company||'';
export function companyScopes(companies,records){
 const scopes=companies.map(c=>({...c,archived:false})),ids=new Set(scopes.map(c=>c.id));
 for(const r of records){const id=recordCompany(r);if(id&&!ids.has(id)){scopes.push({id,name:r.companyName||'Empresa sem cadastro ('+id.slice(0,8)+')',sector:'',archived:true});ids.add(id);}}
 if(records.some(r=>!recordCompany(r)))scopes.unshift({id:'',name:'Sem empresa definida',sector:'',legacy:true,archived:false});
 return scopes;
}
export function companyRecords(records,company){return company===null?[]:records.filter(r=>recordCompany(r)===company);}
export function withCompany(record,company){
 const next={...record};delete next.company;delete next.companyName;
 if(company?.id){next.company=company.id;next.companyName=company.name;}
 return next;
}
export function validateCashCompany(record){
 if(Object.hasOwn(record,'company')&&(typeof record.company!=='string'||!record.company.trim()||record.company.length>100))throw Error('Empresa inválida no lançamento.');
 if(Object.hasOwn(record,'companyName')&&(!record.company||typeof record.companyName!=='string'||!record.companyName.trim()||record.companyName.length>80))throw Error('Nome da empresa inválido no lançamento.');
 return record.company?{company:record.company,...(record.companyName?{companyName:record.companyName}:{})}:{};
}
