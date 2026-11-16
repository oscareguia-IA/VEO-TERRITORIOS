// VEO · App instalable (PWA): acceso directo en la pantalla de inicio, sin tiendas.
(function(){'use strict';
 if('serviceWorker' in navigator&&location.protocol==='https:')
  window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(e=>console.warn('PWA opcional:',e.message)));
 let deferred=null;
 const ua=navigator.userAgent||'';
 const isIOS=/iphone|ipad|ipod/i.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const standalone=()=>window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;document.dispatchEvent(new Event('veo-install-ready'))});
 window.addEventListener('appinstalled',()=>{deferred=null;try{localStorage.setItem('veo_install_hidden','1')}catch(_){}document.dispatchEvent(new Event('veo-install-ready'))});
 window.VEOInstall={
  isIOS,standalone,
  canPrompt:()=>!!deferred,
  // Mostrar la invitación sólo si aún no está instalada y no se ocultó
  shouldOffer:()=>{if(standalone())return false;try{if(localStorage.getItem('veo_install_hidden'))return false}catch(_){}return isIOS||!!deferred||/android/i.test(ua)},
  hide:()=>{try{localStorage.setItem('veo_install_hidden','1')}catch(_){}},
  async prompt(){if(!deferred)return false;deferred.prompt();const r=await deferred.userChoice.catch(()=>null);deferred=null;return r?.outcome==='accepted'}
 };
 // El inicio pudo dibujarse antes de que cargara este archivo: avisar para que se actualice.
 document.dispatchEvent(new Event('veo-install-ready'));
})();
