import {test} from 'node:test';
import assert from 'node:assert/strict';

test('cliente mantém rascunho criptografado quando a rede falha e só confirma após resposta do servidor',async()=>{
 const previous={fetch:globalThis.fetch,window:globalThis.window,localStorage:globalThis.localStorage};
 const values=new Map([['caixa-claro-supabase-session','legacy-token'],['financial-prototype','preservar']]),calls=[],states=[];
 globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
 globalThis.window=new EventTarget();window.addEventListener('caixa:save-state',e=>states.push(e.detail));
 let fail=true,status=200;
 const userA={id:'test-a',draftKey:'a'.repeat(64)},userB={id:'test-b',draftKey:'b'.repeat(64)};let user=userA;
 globalThis.fetch=async(url,options)=>{calls.push({url,options});if(url==='/api/me')return Response.json(user);if(url==='/api/client-error'||url==='/api/logout')return Response.json({ok:true});if(fail)throw Error('offline');return Response.json(status===409?{error:'Conflito de revisão',code:'REVISION_CONFLICT'}:{revision:1},{status});};
 try{
  const {api}=await import('../public/api.js');const drafts=await import('../public/drafts.js');
  assert.equal(values.has('caixa-claro-supabase-session'),false);assert.equal(values.get('financial-prototype'),'preservar');
  await api('me');const payload={revision:0,records:[{description:'Lançamento privado',amount:56789}]};
  await assert.rejects(api('records','PUT',payload),e=>e.code==='CONNECTION_FAILED');
  assert.equal(states.at(-1).state,'pending');assert.equal(states.at(-1).localSaved,true);
  assert.ok(![...values.values()].join().includes('Lançamento privado'));assert.ok(![...values.values()].join().includes('56789'));
  assert.deepEqual((await drafts.pendingDrafts())[0].payload,payload);
  const oldDraft=(await drafts.pendingDrafts())[0];const newer=await drafts.rememberDraft('records',{revision:0,records:[]});drafts.acknowledgeDraft('records',oldDraft.id);assert.equal((await drafts.pendingDrafts())[0].id,newer);
  user=userB;await api('me');assert.deepEqual(await drafts.pendingDrafts(),[]);
  // Mesmo copiar o ciphertext para o namespace da outra conta não permite lê-lo.
  values.set('cc-pending-v1:test-b:records',values.get('cc-pending-v1:test-a:records'));assert.equal((await drafts.pendingDrafts())[0].unreadable,true);drafts.discardDraft('records');
  user=userA;await api('me');fail=false;status=409;await assert.rejects(api('records','PUT',payload),e=>e.status===409);assert.equal((await drafts.pendingDrafts()).length,1);assert.equal(states.at(-1).conflict,true);
  status=200;await api('records','PUT',payload);assert.equal(states.at(-1).state,'saved');assert.deepEqual(await drafts.pendingDrafts(),[]);
  await drafts.rememberDraft('dre',{revision:0,document:{version:1,companies:[],entries:[]}});
  // Alterar a data externa não prolonga o prazo autenticado do rascunho.
  const realNow=Date.now;try{Date.now=()=>realNow()+8*86400000;const k='cc-pending-v1:test-a:dre',entry=JSON.parse(values.get(k));entry.updatedAt=Date.now();values.set(k,JSON.stringify(entry));assert.deepEqual(await drafts.pendingDrafts(),[]);assert.equal(values.has(k),false);}finally{Date.now=realNow;}
  await drafts.rememberDraft('records',payload);const k='cc-pending-v1:test-a:records',entry=JSON.parse(values.get(k));entry.data=entry.data.slice(0,-8)+'AAAAAA==';values.set(k,JSON.stringify(entry));assert.equal((await drafts.pendingDrafts())[0].unreadable,true);
  await api('logout','POST',{});assert.deepEqual(await drafts.pendingDrafts(),[]);
  assert.ok(calls.every(c=>c.url.startsWith('/api/')&&c.options.credentials==='same-origin'&&!c.options.headers.Authorization));
  assert.ok(!JSON.stringify(calls.filter(c=>c.url==='/api/client-error')).includes('Lançamento privado'));
 }finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

