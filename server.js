// O modo Supabase/servidor é o único destinado ao público.
if(process.env.SUPABASE_URL){
 const {createPublicServer}=await import('./server/node-server.js');
 createPublicServer().listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Caixa Claro: servidor Supabase iniciado.'));
}else{
 const {makeServer}=await import('./auth-server.js');
 const {server}=makeServer();server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Caixa Claro: modo local privado legado. Cadastro público indisponível.'));
}
