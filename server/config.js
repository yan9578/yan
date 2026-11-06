export function serverConfig(env=process.env){
 const production=env.NODE_ENV==='production'||env.NETLIFY==='true';
 const config={production,origin:env.APP_ORIGIN||'',url:env.SUPABASE_URL||'',key:env.SUPABASE_PUBLISHABLE_KEY||'',serviceKey:env.SUPABASE_SERVICE_ROLE_KEY||'',secret:env.SESSION_SECRET||'',publicAuth:env.PUBLIC_AUTH_ENABLED==='true',emailReady:env.EMAIL_SETUP_CONFIRMED==='true',backupReady:env.BACKUP_SETUP_CONFIRMED==='true',captchaSiteKey:env.TURNSTILE_SITE_KEY||'',privacyController:env.PRIVACY_CONTROLLER||'',privacyContact:env.PRIVACY_CONTACT_EMAIL||'',databaseLimitMb:env.DATABASE_LIMIT_MB?Number(env.DATABASE_LIMIT_MB):null,netlifyToken:env.NETLIFY_API_TOKEN||'',netlifyAccount:env.NETLIFY_ACCOUNT_SLUG||'',netlifyDashboard:env.NETLIFY_DASHBOARD_URL||'',aliases:{yan:env.YAN_AUTH_EMAIL||'yansiqueirapedro@gmail.com',yan1:env.YAN1_AUTH_EMAIL||'playerboot09@gmail.com'}};
 if(!config.url.startsWith('https://')||!config.origin||!config.key||!config.serviceKey||config.secret.length<32)throw Error('Configuração do servidor incompleta. Consulte docs/PUBLICACAO.md.');
 const origin=new URL(config.origin),url=new URL(config.url);
 if(origin.origin!==config.origin||url.origin!==config.url||url.hostname.endsWith('.supabase.co')===false)throw Error('Origem ou URL do Supabase inválida.');
 if(production&&origin.protocol!=='https:')throw Error('Produção exige HTTPS.');
 if(!config.key.startsWith('sb_publishable_')){try{const claims=JSON.parse(Buffer.from(config.key.split('.')[1],'base64url'));if(claims.role!=='anon')throw Error();}catch{throw Error('SUPABASE_PUBLISHABLE_KEY deve conter a chave pública Publishable/anon.');}}
 if(!config.serviceKey.startsWith('sb_secret_')){try{const claims=JSON.parse(Buffer.from(config.serviceKey.split('.')[1],'base64url'));if(claims.role!=='service_role')throw Error();}catch{throw Error('Configure uma chave administrativa somente no servidor.');}}
 if(config.publicAuth&&(!config.emailReady||!config.backupReady||!config.privacyController||!/^\S+@\S+\.\S+$/.test(config.privacyContact)||(production&&!config.captchaSiteKey)))throw Error('Antes de habilitar cadastro público, configure SMTP, backups, privacidade e CAPTCHA.');
 return config;
}
