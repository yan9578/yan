function invalid(message,variable,reason='INVALID_FORMAT'){const error=Error(message);error.configVariable=variable;error.configReason=reason;throw error;}
export function serverConfig(env=process.env){
 const value=name=>String(env[name]||'').trim();
 const production=env.NODE_ENV==='production'||env.NETLIFY==='true';
 const config={production,origin:value('APP_ORIGIN'),url:value('SUPABASE_URL'),key:value('SUPABASE_PUBLISHABLE_KEY'),serviceKey:value('SUPABASE_SERVICE_ROLE_KEY'),secret:env.SESSION_SECRET||'',publicAuth:env.PUBLIC_AUTH_ENABLED==='true',emailReady:env.EMAIL_SETUP_CONFIRMED==='true',backupReady:env.BACKUP_SETUP_CONFIRMED==='true',captchaSiteKey:env.TURNSTILE_SITE_KEY||'',privacyController:env.PRIVACY_CONTROLLER||'Yan',privacyContact:env.PRIVACY_CONTACT_EMAIL||'yansiqueirapedro@gmail.com',databaseLimitMb:env.DATABASE_LIMIT_MB?Number(env.DATABASE_LIMIT_MB):null,netlifyToken:env.NETLIFY_API_TOKEN||'',netlifyAccount:env.NETLIFY_ACCOUNT_SLUG||'',netlifyDashboard:env.NETLIFY_DASHBOARD_URL||'',aliases:{yan:env.YAN_AUTH_EMAIL||'yansiqueirapedro@gmail.com',yan1:env.YAN1_AUTH_EMAIL||'playerboot09@gmail.com'}};
 for(const [variable,value] of [['SUPABASE_URL',config.url],['APP_ORIGIN',config.origin],['SUPABASE_PUBLISHABLE_KEY',config.key],['SUPABASE_SERVICE_ROLE_KEY',config.serviceKey],['SESSION_SECRET',config.secret]])if(!value)invalid('Configuração do servidor incompleta. Consulte docs/PUBLICACAO.md.',variable,'MISSING');
 if(config.secret.length<32)invalid('SESSION_SECRET exige pelo menos 32 caracteres.','SESSION_SECRET','TOO_SHORT');
 let origin,url;
 try{origin=new URL(config.origin);}catch{invalid('Origem inválida.','APP_ORIGIN');}
 try{url=new URL(config.url);}catch{invalid('URL do Supabase inválida.','SUPABASE_URL');}
 if(origin.origin!==config.origin)invalid('Origem inválida.','APP_ORIGIN');
 if(url.protocol!=='https:'||url.origin!==config.url||!url.hostname.endsWith('.supabase.co'))invalid('URL do Supabase inválida.','SUPABASE_URL');
 if(production&&origin.protocol!=='https:')invalid('Produção exige HTTPS.','APP_ORIGIN');
 if(!config.key.startsWith('sb_publishable_')){try{const claims=JSON.parse(Buffer.from(config.key.split('.')[1],'base64url'));if(claims.role!=='anon')throw Error();}catch{invalid('SUPABASE_PUBLISHABLE_KEY deve conter a chave pública Publishable/anon.','SUPABASE_PUBLISHABLE_KEY');}}
 if(!config.serviceKey.startsWith('sb_secret_')){try{const claims=JSON.parse(Buffer.from(config.serviceKey.split('.')[1],'base64url'));if(claims.role!=='service_role')throw Error();}catch{invalid('Configure uma chave administrativa somente no servidor.','SUPABASE_SERVICE_ROLE_KEY');}}
 if(config.publicAuth&&(!config.emailReady||!config.backupReady||!config.privacyController||!/^\S+@\S+\.\S+$/.test(config.privacyContact)||(production&&!config.captchaSiteKey)))invalid('Antes de habilitar cadastro público, configure SMTP, backups, privacidade e CAPTCHA.','PUBLIC_AUTH_ENABLED');
 return config;
}
