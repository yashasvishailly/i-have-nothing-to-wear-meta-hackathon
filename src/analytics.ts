// Public project identifiers observed on the owner's public website. No admin/API secrets.
export const analyticsConfig={origin:'https://wardrobe.yashasvishailly.com',gaId:'G-HZHK4BW8C7',posthogKey:'phc_rnYtAJTUPGb5xW7QVHQy5dvyLwnVAtqNxaQEcLLJ6sGC',gaManualVerified:true};
export const usageEvents=['pile_open','wardrobe_open','hanger_open','look_saved','demo_started'] as const;
export type UsageEvent=typeof usageEvents[number];
const choiceKey='wardrobe-usage-consent-v1';
interface Runtime {origin:string;internal:boolean;storage:Pick<Storage,'getItem'|'setItem'>;send:typeof fetch;uuid:()=>string;ga?:(event:UsageEvent,internal:boolean)=>void;onChoice?:(value:boolean)=>void;}
export class UsageAnalytics {
 constructor(private runtime:Runtime){}
 consent(){try{return this.runtime.storage.getItem(choiceKey)==='yes';}catch{return false;}}
 setConsent(value:boolean){try{this.runtime.storage.setItem(choiceKey,value?'yes':'no');}catch{}this.runtime.onChoice?.(value);}
 async capture(event:UsageEvent){
  if(this.runtime.origin!==analyticsConfig.origin||!this.consent()||!usageEvents.includes(event))return;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{
   // A new random ID per event: no persistent browser/person/session identity or profile.
   await this.runtime.send('https://us.i.posthog.com/i/v0/e/',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:analyticsConfig.posthogKey,event,distinct_id:this.runtime.uuid(),properties:{$process_person_profile:false,$geoip_disable:true,app:'wardrobe',environment:this.runtime.internal?'internal':'production',traffic_type:this.runtime.internal?'internal':'external'}})});
  }catch{/* Analytics must never block the wardrobe; no logging or retry. */}finally{clearTimeout(timer);}
  if(this.consent()&&analyticsConfig.gaManualVerified)this.runtime.ga?.(event,this.runtime.internal);
 }
}
export function browserAnalytics(){const usage=new UsageAnalytics({origin:location.origin,internal:new URLSearchParams(location.search).get('internal')==='1',storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},send:fetch.bind(window),uuid:()=>crypto.randomUUID(),ga:sendGoogleEvent,onChoice:setGoogleChoice});setGoogleChoice(usage.consent());return usage;}
function setGoogleChoice(value:boolean){const w=window as unknown as Record<string,unknown>;w['ga-disable-'+analyticsConfig.gaId]=!value;}
let googleLoaded=false;
function sendGoogleEvent(event:UsageEvent,internal:boolean){
 if(!analyticsConfig.gaManualVerified||(window as unknown as Record<string,unknown>)['ga-disable-'+analyticsConfig.gaId])return;
 const w=window as unknown as {dataLayer:unknown[];gtag:(...args:unknown[])=>void};
 if(!googleLoaded){googleLoaded=true;w.dataLayer=[];w.gtag=function(){w.dataLayer.push(arguments);};
  // Cookieless measurement only; no advertising, URL pass-through or persistent client ID.
  w.gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
  w.gtag('set','url_passthrough',false);w.gtag('set','ads_data_redaction',true);w.gtag('js',new Date());w.gtag('config',analyticsConfig.gaId,{send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,page_location:analyticsConfig.origin+'/',page_referrer:'',page_title:'Wardrobe',ignore_referrer:true});
  const script=document.createElement('script');script.async=true;script.src='https://www.googletagmanager.com/gtag/js?id='+analyticsConfig.gaId;document.head.append(script);
 }
 w.gtag('event',event,{send_to:analyticsConfig.gaId,app_name:'wardrobe',traffic_type:internal?'internal':'external',page_location:analyticsConfig.origin+'/',page_referrer:''});
}
