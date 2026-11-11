import {serverConfig} from './config.js';

// Configurações públicas do projeto publicado pelo proprietário. As variáveis
// cadastradas na Vercel têm prioridade, inclusive numa futura troca de domínio.
// Nenhuma chave de acesso ou segredo é fornecido por estes padrões.
export const vercelDefaults=Object.freeze({
 APP_ORIGIN:'https://yan-khaki-two.vercel.app',
 SUPABASE_URL:'https://ppzlnrydbdxdkbytrwly.supabase.co',
 GOOGLE_AUTH_ENABLED:'true',
 EMAIL_CODES_ENABLED:'false',
 PUBLIC_AUTH_ENABLED:'false',
 EMAIL_SETUP_CONFIRMED:'false',
 BACKUP_SETUP_CONFIRMED:'true',
 TURNSTILE_SITE_KEY:'0x4AAAAAAF2zlWnNaTaZnMBX',
 PRIVACY_CONTROLLER:'Yan',
 PRIVACY_CONTACT_EMAIL:'yansiqueirapedro@gmail.com'
});

export function vercelConfig(env=process.env){return serverConfig({...vercelDefaults,...env});}
