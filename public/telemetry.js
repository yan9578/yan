import {api} from './api.js';
let consent=false,visitSent=false;
export function initTelemetry(){
 try{consent=localStorage.getItem('cc-analytics-consent')==='yes';}catch{}
 const banner=document.getElementById('analytics-banner');
 let decided=false;try{decided=!!localStorage.getItem('cc-analytics-consent');}catch{}
 banner.hidden=decided;
 document.getElementById('analytics-allow').onclick=()=>choose(true);
 document.getElementById('analytics-decline').onclick=()=>choose(false);
 if(consent)track('cash','visit');
 async function choose(value){consent=value;try{localStorage.setItem('cc-analytics-consent',value?'yes':'no');}catch{}banner.hidden=true;try{await api('analytics-consent','POST',{allowed:value});}catch{}if(value)track('cash','visit');}
}
export async function track(feature,kind='feature'){
 if(!consent)return;if(kind==='visit'&&visitSent)return;if(kind==='visit')visitSent=true;
 try{await api('events','POST',{kind,feature,consent:true});}catch{}
}
export function reviewConsent(){document.getElementById('analytics-banner').hidden=false;}

let lastError=0;
async function reportError(code){if(Date.now()-lastError<10000)return;lastError=Date.now();try{await api('client-error','POST',{code,feature:'account'});}catch{}}
window.addEventListener('error',()=>reportError('JS_ERROR'));
window.addEventListener('unhandledrejection',()=>reportError('UNHANDLED_REJECTION'));
