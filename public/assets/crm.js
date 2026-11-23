
/* VEO TERRITORIOS | Interfaz existente conectada a API segura en Vercel. */
'use strict';
const PHASES=['BUSQUEDA_FACTIBILIDAD','PRIMER_CONTACTO','SEGUIMIENTO','CIERRE','EN_OPERACION'];
const PHASELABEL=['BÚSQUEDA / FACTIBILIDAD','PRIMER CONTACTO / CALIFICADOS','SEGUIMIENTO','CIERRE','EN OPERACIÓN'];
const COLORS=['#21cee5','#a88dff','#ffb765','#ff4b84','#3ddc97'];
const DOC_TYPES={foto:'Fotografía del predio',satelital:'Mapa satelital / evidencia',dron:'Video con dron (opcional)',carta_intencion:'Carta de intención',predial:'Recibo de pago del predial',contrato:'Contrato condicionado',mecanica_suelos:'Mecánica de suelos (opcional)',memoria_calculo:'Memoria de cálculo',factibilidad_electrica:'Factibilidad eléctrica',permiso_municipal:'Permiso municipal (opcional)',programa_obra:'Evidencia de programa de obra',operacion:'Fotos / videos en operación',otro:'Otros documentos'};
const WEIGHTS={flujo:45,visibilidad:25,electrica:10,propietario:10,comercial:10};
const RATINGLABEL={flujo:'Intensidad y sentido de tráfico',visibilidad:'Visibilidad y tiempo de exposición',electrica:'Acceso y factibilidad eléctrica',propietario:'Disponibilidad y acceso al propietario',comercial:'Condiciones económicas estimadas'};
const demo=false; // Modo multiusuario: todas las operaciones se validan en la API de Vercel.
const root=document.getElementById('view'), loginRoot=document.getElementById('login-root'), shell=document.getElementById('shell');
let state={view:'dashboard',data:null,user:null,csrf:'',selectedCorridor:0,phaseFilter:'',brokerFilter:'',search:'',map:null,markers:null,tileLayer:null,base:'streets',mapProvider:'veo',drawer:null,drawerTab:'general',pin:null,picker:null,loading:false};
const E=s=>String(s===null||s===undefined?'':s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const initials=s=>String(s||'V').trim().split(/\s+/).slice(0,2).map(x=>x.charAt(0)).join('').toUpperCase();
const fmt=n=>Number(n||0).toLocaleString('es-MX');
let veoGeoProof=null;
const veoGeoEqual=(p,id,lat,lng)=>p&&(p.ok||(p.status==='unavailable'&&Date.now()-p.checkedAt<120000))&&+p.corridor_id===+id&&Math.abs(+p.lat-lat)<0.0000008&&Math.abs(+p.lng-lng)<0.0000008;
const CORRIDOR_MAX_M=150; // tolerancia: el predio puede estar a pie de avenida
function distToLinesM(point,lines){
 const R=6371000,rad=Math.PI/180,k=Math.cos(point.lat*rad);let best=Infinity;
 const xy=p=>[(p[1]-point.lng)*rad*R*k,(p[0]-point.lat)*rad*R];
 for(const line of lines||[])for(let i=0;i<line.length-1;i++){
  const [ax,ay]=xy(line[i]),[bx,by]=xy(line[i+1]),dx=bx-ax,dy=by-ay,L=dx*dx+dy*dy;
  let t=L?-(ax*dx+ay*dy)/L:0;t=Math.max(0,Math.min(1,t));
  const d=Math.hypot(ax+t*dx,ay+t*dy);if(d<best)best=d;
 }
 return best;
}
const fmtDist=m=>m<1000?Math.round(m)+' m':(m/1000).toFixed(1)+' km';
function corridorLineCheck(corridorId,point,lines){
 if(!corridorId)return {ok:false,status:'outside',message:'Selecciona primero el corredor del predio.'};
 if(!lines?.length)return {ok:true,status:'validated',noLine:true};
 const d=distToLinesM(point,lines);
 if(d<=CORRIDOR_MAX_M)return {ok:true,status:'validated',distance:d};
 return {ok:false,status:'outside',distance:d,message:`El pin está a ${fmtDist(d)} de la línea del corredor ${cname(corridorId)}. Acomoda el pin sobre la línea rosa para poder registrar la oportunidad.`};
}
async function validateCorridorPoint(corridorId,point){
 let lines=null;try{lines=(await window.VEORoutes?.load(+corridorId,{demo:true}))?.lines}catch(_){}
 return corridorLineCheck(+corridorId,point,lines);
}
async function validateCorridorPointOriginal(corridorId,point){
 if(!point||!corridorId)return {ok:false,status:'outside',message:'Selecciona corredor y pin GPS.'};
 if(demo)return await window.VEOCorridorGeo.validate(corridorId,point);
 return await api('/api/geo/validate',{method:'POST',body:JSON.stringify({corridor_id:+corridorId,lat:point.lat,lng:point.lng})});
}
async function assertCorridorPoint(corridorId,point){
 const result=veoGeoEqual(veoGeoProof,corridorId,point.lat,point.lng)?veoGeoProof:await validateCorridorPoint(corridorId,point);
 if(result.status==='outside')throw Error(result.message||'El pin está fuera del corredor');
 veoGeoProof={...result,corridor_id:+corridorId,lat:point.lat,lng:point.lng,checkedAt:Date.now()};return result;
}

const day=s=>s?new Date(s).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}):'—';
const cname=id=>(state.data?.corridors||[]).find(x=>x.id==id)?.name||'Corredor';
const corridor=id=>(state.data?.corridors||[]).find(x=>x.id==id);
// Límites geográficos de un trazado cartografiado; se calculan de cada punto GPS,
// NO de la intersección guía ni de un punto inventado.
function routeGeoBounds(lines){
 let south=Infinity,west=Infinity,north=-Infinity,east=-Infinity,used=0;
 for(const segment of lines||[]){for(const point of segment||[]){
  const lat=Number(point?.[0]),lng=Number(point?.[1]);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)continue;
  south=Math.min(south,lat);north=Math.max(north,lat);west=Math.min(west,lng);east=Math.max(east,lng);used++;
 }}
 return used>1?{south,west,north,east}:null;
}
function indicativeCorridorBounds(id){
 const b=window.VEORoutes?.BOUNDS?.[id];
 return b&&b.length===4?{south:b[0],west:b[1],north:b[2],east:b[3]}:null;
}
// Resaltado de avenida basado en segmentos OSM reales; nunca confunde
// trazado cartográfico con delimitación legal o geoverificación del pin.
const ROUTE_HIGHLIGHT_COLOR='#ff416d';
function routeLabel(result){
 if(result?.lines?.length)return result.status==='cached'?'◉ Trazo de referencia OSM guardado · rosa':'◉ Avenida identificada y resaltada · rosa';
 return 'Sin geometría disponible. Reintentar trazado cuando haya conexión.';
}
function showRouteStatus(element,result){if(!element)return;
 element.className='veo-route-status'+(result?.lines?.length?' active':result?.status==='loading'?' loading':' unavailable');
 const label=result?.status==='loading'?'Consultando el trazado geográfico de la avenida…':routeLabel(result);
 element.textContent=label;
}
function setGoogleCorridorRoute(pk,result){
 if(pk.googleRouteLines){for(const line of pk.googleRouteLines)line.setMap(null)}pk.googleRouteLines=[];
 if(!pk.googleMap||!window.google?.maps||!result?.lines?.length)return;
 for(const points of result.lines){
  pk.googleRouteLines.push(new google.maps.Polyline({map:pk.googleMap,path:points.map(p=>({lat:p[0],lng:p[1]})),
    strokeColor:ROUTE_HIGHLIGHT_COLOR,strokeOpacity:.93,strokeWeight:7,clickable:false,zIndex:12}));
 }
}
async function highlightPickerCorridor(id){
 const pk=state.picker;if(!pk)return;const token=pk.routeToken=(pk.routeToken||0)+1;
 pk.routeData=null;pk.map?.setRoute([],{});setGoogleCorridorRoute(pk,null);if(pk.point)pickerValidatePoint(pk.point);
 const status=document.getElementById('picker-route-status');showRouteStatus(status,{status:'loading'});
 const result=await window.VEORoutes.load(id,{demo:true});
 if(state.picker!==pk||pk.corridorId!==+id||pk.routeToken!==token)return;
 pk.routeData=result;pk.map?.setRoute(result.lines,{color:ROUTE_HIGHLIGHT_COLOR});
 setGoogleCorridorRoute(pk,result);showRouteStatus(status,result);
 // The road layer can arrive after a pin was chosen; revalidate instantly from it.
 if(pk.point&&result.lines?.length)pickerValidatePoint({...pk.point});
}
async function highlightOpportunityCorridor(map,id){
 const token=state.routeToken=(state.routeToken||0)+1;
 map.setRoute([],{});
 const status=document.getElementById('opportunity-route-status');
 if(!id){if(status)status.textContent='Selecciona un corredor para resaltar la avenida en rosa.';return}
 showRouteStatus(status,{status:'loading'});
 const result=await window.VEORoutes.load(id,{demo:true});if(state.map!==map||token!==state.routeToken)return;
 map.setRoute(result.lines,{color:ROUTE_HIGHLIGHT_COLOR});showRouteStatus(status,result);
 // Con geometría OSM, ajustar TODO el corredor al área visible (con márgenes);
 // si el usuario ya movió el mapa, respetar su navegación y no recentrar de golpe.
 const exact=routeGeoBounds(result.lines);
 if(exact&&!map.userNavigated){map.fitBounds(exact,{padding:{x:46,y:78},maxZoom:15,animate:true});
  const hint=document.getElementById('opportunity-framing-note');if(hint)hint.textContent='Corredor ajustado al trazado vial disponible · puedes acercar para revisar los predios.';
 }else if(!exact){const hint=document.getElementById('opportunity-framing-note');if(hint)hint.textContent='Vista general orientativa; el trazado de la avenida aún no está disponible.';}
}

const phaseName=key=>PHASELABEL[PHASES.indexOf(key)]||'Sin fase';
const phaseColor=key=>COLORS[PHASES.indexOf(key)]||COLORS[0];
const stageIndex=phase=>PHASES.indexOf(phase);
const isManager=()=>['admin','supervisor'].includes(state.user?.role);
const isAdmin=()=>state.user?.role==='admin';
const toast=(msg,error=false)=>{const x=document.getElementById('toast');x.textContent=msg;x.className='toast'+(error?' error':'');clearTimeout(toast.t);toast.t=setTimeout(()=>x.classList.add('hidden'),5500)};
function icon(name){const paths={grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',map:'<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>',pipeline:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v10m5-10v10m5-10v10"/>',pin:'<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',approval:'<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 7h8m-8 4h8m-8 4 2 2 5-5"/>',file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8m-8 4h8"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-1.9 1.9-.06-.06A1.65 1.65 0 0 0 16 18.4a1.65 1.65 0 0 0-1 .9v.7h-3v-.7a1.65 1.65 0 0 0-1-.9 1.65 1.65 0 0 0-1.82.33l-.06.06-1.9-1.9.06-.06A1.65 1.65 0 0 0 7.6 15a1.65 1.65 0 0 0-.9-1H6v-3h.7a1.65 1.65 0 0 0 .9-1A1.65 1.65 0 0 0 7.27 8.2l-.06-.06 1.9-1.9.06.06A1.65 1.65 0 0 0 11 6.6a1.65 1.65 0 0 0 1-.9V5h3v.7a1.65 1.65 0 0 0 1 .9 1.65 1.65 0 0 0 1.82-.33l.06-.06 1.9 1.9-.06.06A1.65 1.65 0 0 0 19.4 10a1.65 1.65 0 0 0 .9 1h.7v3h-.7a1.65 1.65 0 0 0-.9 1Z"/>',cross:'<path d="M18 6 6 18M6 6l12 12"/>',target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',chart:'<path d="M3 3v18h18"/><path d="m7 16 4-6 4 3 5-8"/>',chevron:'<path d="m9 18 6-6-6-6"/>'};return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">${paths[name]||paths.grid}</svg>`}
const demoKey='veo_territorios_demo_v1';
function hasLocalDemoData(){try{return !!localStorage.getItem(demoKey)}catch(_){return false}}
async function exportLocalBackup(){
 const contents=localStorage.getItem(demoKey);if(!contents)throw Error('Este navegador no contiene datos de la versión anterior.');
 const blob=new Blob([contents],{type:'application/json;charset=utf-8'});
 const filename='VEO_respaldo_local_'+new Date().toISOString().slice(0,10)+'.json';
 const file=new File([blob],filename,{type:'application/json'});
 if(navigator.canShare?.({files:[file]})&&navigator.share){try{await navigator.share({files:[file],title:'Respaldo local VEO'});return}catch(e){if(e.name==='AbortError')return}}
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),12000);
}

async function api(path,options={}){
 let headers={...options.headers};if(options.method&&options.method!=='GET'&&!(options.body instanceof FormData))headers['Content-Type']='application/json';if(options.method&&options.method!=='GET'&&path!=='/api/login')headers['X-CSRF-Token']=state.csrf;{const u=unlockFor(state.drawer?.predio?.id);if(u)headers['X-VEO-Unlock']=u.token}
 let r=await fetch(path,{...options,headers,credentials:'same-origin'});
 if(r.status===401&&path!=='/api/login'){loginScreen();throw Error('Sesión vencida: vuelva a iniciar sesión')}
 if(!r.ok){let d;try{d=await r.json()}catch{d={detail:r.statusText}}let text=typeof d.detail==='string'?d.detail:(d.detail?.missing?'Faltan requisitos: '+d.detail.missing.join('; '):JSON.stringify(d.detail||d));throw Error(text)}
 return r.json();
}
async function loadAll(){
 const data=await api('/api/bootstrap');if(!data.corridors)data.corridors=window.VEO_DEMO_CORRIDORS||[];state.data=data;state.user=data.user;state.csrf=data.csrf;
 if(data.must_change_password||data.user?.must_change_password){passwordChangeScreen(true);return}
 shell.classList.remove('hidden');loginRoot.innerHTML='';render();window.veoIdleReset?.();
 const gk=googleMapsJSKey();if(gk&&window.VEOGoogleMap)setTimeout(()=>loadGoogleMapsJS(gk).catch(()=>{}),state.view==='mapa'?0:1200);
}
async function refresh(reopen=false){const current=state.drawer?.predio?.id;const tab=state.drawerTab;await loadAll();if(reopen&&current){await openPredio(current,tab)}}
function loginScreen(){state.user=null;shell.classList.add('hidden');document.getElementById('drawer').innerHTML='';loginRoot.innerHTML=`<div class="auth-wrap"><div class="auth-card login-card"><img class="login-logo" src="${DEMO_LOGO}" alt="Logotipo VEO" /><div class="page-kicker">VEO TERRITORIOS</div><h1>Iniciar sesión</h1><p class="login-subtitle">Accede a tu espacio VEO TERRITORIOS</p><form data-form="login"><div class="field-group"><label class="field-label" for="veo-login-username">Usuario</label><input id="veo-login-username" name="username" class="field" autocomplete="username" required placeholder="Nombre de usuario" /></div><div class="field-group"><label class="field-label" for="veo-login-password">Contraseña</label><input id="veo-login-password" name="password" type="password" class="field" autocomplete="current-password" required placeholder="Contraseña" /></div><label class="auth-show-password"><input type="checkbox" data-toggle-password aria-label="Mostrar contraseña" /><span>Mostrar contraseña</span></label><button class="btn btn-primary" type="submit">ENTRAR AL CRM</button></form><p class="login-footnote">Acceso autorizado VEO</p>${hasLocalDemoData()?'<button type="button" class="btn btn-ghost small mt12" data-action="export-local-backup">RESPALDAR DATOS ANTERIORES DE ESTE DISPOSITIVO</button>':''}</div></div>`}
function passwordChangeScreen(force=false){
 shell.classList.add('hidden');
 const html=`<div class="auth-wrap"><div class="auth-card"><img class="login-logo" src="${DEMO_LOGO}" alt="VEO" /><div class="page-kicker">${force?'PRIMER ACCESO · CAMBIO OBLIGATORIO':'SEGURIDAD DE CUENTA'}</div><h1>${force?'Protege tu cuenta':'Cambiar mi contraseña'}</h1><p>${force?'La contraseña inicial fue asignada por el Administrador. Define una contraseña privada para continuar.':'Sólo tú puedes cambiar tu contraseña personal. El Administrador puede restablecerla, pero no consultarla.'}</p>${changePasswordForm(force)}${force?'<button type="button" class="btn btn-ghost small mt12" data-action="logout">CERRAR SESIÓN Y CAMBIAR DE USUARIO</button>':''}</div></div>`;
 loginRoot.innerHTML=html;
}
const DEMO_LOGO='/assets/media/logo-veo.png';
function changePasswordForm(force=false){return `<form data-form="change-password" class="password-form"><div class="field-group"><label class="field-label">Contraseña actual o temporal</label><input class="field" type="password" name="current_password" autocomplete="current-password" minlength="7" required placeholder="Contraseña recibida" /></div><div class="field-group"><label class="field-label">Nueva contraseña</label><input class="field" type="password" name="new_password" autocomplete="new-password" minlength="7" required placeholder="7 caracteres como mínimo" /></div><div class="field-group"><label class="field-label">Confirmar nueva contraseña</label><input class="field" type="password" name="confirm_password" autocomplete="new-password" minlength="7" required placeholder="Repite tu nueva contraseña" /></div><label class="auth-show-password"><input type="checkbox" data-toggle-password aria-label="Mostrar contraseñas" /><span>Mostrar contraseñas</span></label><div class="spaced mt20"><button class="btn btn-primary" type="submit">${force?'GUARDAR Y ENTRAR AL CRM':'ACTUALIZAR CONTRASEÑA'}</button>${force?'':'<button type="button" class="btn btn-ghost" data-action="close-modal">CANCELAR</button>'}</div></form>`}
function showOwnPasswordForm(){if(!state.user)return loginScreen();const m=document.getElementById('modal');m.innerHTML=`<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="selfpw-title"><div class="modal-top"><div><small>SEGURIDAD DE MI CUENTA</small><h2 id="selfpw-title">Cambiar contraseña</h2></div><button class="icon-btn" data-action="close-modal">×</button></div><div class="alert-box">La contraseña es privada. El Administrador sólo ve la fecha del cambio y puede restablecer una temporal.</div>${changePasswordForm(false)}</div>`;m.querySelector('input[name="current_password"]')?.focus()}
const NAV=[['dashboard','Centro de control','grid'],['mapa','Mapa de oportunidades','map'],['pipeline','Pipeline de adquisición','pipeline'],['predios','Expedientes / Predios','pin'],['aprobaciones','Aprobaciones','approval'],['brokers','Brokers y usuarios','users'],['credenciales','Gestión de credenciales','settings'],['fuentes','Inteligencia vial','chart'],['config','Configuración','settings']];
function renderNav(){
 const pending=state.data?.requests.filter(x=>x.status==='pendiente').length||0;
 document.getElementById('main-nav').innerHTML=NAV.filter(([key])=>(key!=='credenciales'||isAdmin())&&(key!=='brokers'||state.user.role!=='broker')).map(([key,label,ico])=>`<button data-action="nav" data-view="${key}" class="${state.view===key?'active':''}" title="${label}" aria-current="${state.view===key?'page':'false'}">${icon(ico)} <span>${label}</span>${key==='aprobaciones'&&pending?`<span class="count">${pending}</span>`:''}</button>`).join('');
 document.getElementById('side-profile').innerHTML=`<div class="avatar">${E(initials(state.user?.display_name))}</div><div class="profile-info"><strong>${E((state.user?.display_name||'').replace(/\s*·\s*Modo demostración/gi,''))}</strong><small>${E(state.user?.role?.toUpperCase())}</small></div><button class="icon-btn" data-action="my-password" title="Cambiar mi contraseña" aria-label="Cambiar mi contraseña">⚿</button><button class="icon-btn" data-action="logout" title="Cerrar sesión" aria-label="Cerrar sesión">⏻</button>`;
 const mobile=document.getElementById('mobile-nav');if(mobile)mobile.innerHTML=[['dashboard','Inicio','grid'],['mapa','Mapa','map'],['pipeline','Fases','pipeline'],['predios','Predios','pin'],['aprobaciones','Revisar','approval']].map(([key,label,ico])=>`<button type="button" data-action="nav" data-view="${key}" class="${state.view===key?'active':''}" aria-label="${label}" aria-current="${state.view===key?'page':'false'}">${icon(ico)}<span>${label}</span></button>`).join('');
 const label=NAV.find(x=>x[0]===state.view)?.[1]||'Centro de control';
 const breadcrumb=document.querySelector('.top-crumb');if(breadcrumb)breadcrumb.innerHTML=`VEO <span>/</span> ${E(label.toUpperCase())}`;
 closeMobileMenu();
}
document.addEventListener('veo-install-ready',()=>{if(state.data&&(state.view||'dashboard')==='dashboard')render()});
function render(){
 if(!state.data)return;
 closeMap();renderNav();
 const views={dashboard:renderDashboard,mapa:renderMap,pipeline:renderPipeline,predios:renderPredios,aprobaciones:renderApprovals,brokers:renderBrokers,fuentes:renderSources,config:renderConfig,credenciales:renderCredentials};
 root.innerHTML=(views[state.view]||renderDashboard)();
 // «Registrar predio» sólo en Inicio, Mapa de oportunidades y Pipeline
 const vista=views[state.view]?state.view:'dashboard';
 document.querySelectorAll('.top-actions [data-action="new-predio"]').forEach(b=>b.classList.toggle('vista-oculta',!['dashboard','mapa','pipeline'].includes(vista)));
 root.classList.toggle('map-fullwidth',state.view==='mapa');
 root.classList.remove('view-animate');void root.offsetWidth;root.classList.add('view-animate');
 hydrateGoogleMaps();
 if(state.view==='mapa'){fitMobileMap();setTimeout(initMap,70)}
}
// Celular: el mapa va arriba y ocupa todo el alto visible entre la barra superior y el menú inferior.
function fitMobileMap(){
 const w=document.querySelector('.mapa-page .map-wrap');if(!w)return;
 if(!matchMedia('(max-width:720px)').matches){w.style.height='';return}
 const nav=document.getElementById('mobile-nav'),navH=nav&&getComputedStyle(nav).display!=='none'?nav.offsetHeight:0;
 const top=w.getBoundingClientRect().top+window.scrollY;
 w.style.height=Math.max(360,Math.round(window.innerHeight-top-navH-10))+'px';
}
window.addEventListener('resize',()=>{if(state.view==='mapa')fitMobileMap()},{passive:true});
function closeMobileMenu(){document.querySelector('.sidebar')?.classList.remove('open');document.getElementById('sidebar-backdrop')?.classList.remove('active')}
function toggleMobileMenu(){const open=document.querySelector('.sidebar')?.classList.toggle('open');document.getElementById('sidebar-backdrop')?.classList.toggle('active',!!open)}
function hydrateGoogleMaps(){
 const frames=[...document.querySelectorAll('iframe.google-map-iframe[data-map-src]')];if(!frames.length)return;
 if(!('IntersectionObserver' in window)){for(const el of frames){el.src=el.dataset.mapSrc;delete el.dataset.mapSrc}return}
 const observer=new IntersectionObserver(entries=>{for(const item of entries){if(!item.isIntersecting)continue;const el=item.target;if(el.dataset.mapSrc){el.src=el.dataset.mapSrc;delete el.dataset.mapSrc}observer.unobserve(el)}if(!document.querySelector('iframe[data-map-src]'))observer.disconnect()},{rootMargin:'260px 0px',threshold:0});
 frames.forEach(f=>observer.observe(f));
}
const title=(kicker,name,sub,side='')=>`<div class="page-row"><div><div class="page-kicker">${kicker}</div><h1 class="page-title">${name}</h1>${sub?`<div class="subhead">${sub}</div>`:''}</div>${side?`<div class="spaced">${side}</div>`:''}</div>`;
const metric=(name,num,hint,color)=>`<div class="metric"><small>${name}</small><b style="color:${color||'#f0f6ff'}">${num}</b><em>${hint}</em><span class="tiny-bar" style="background:${color||COLORS[0]}"></span></div>`;
const listEmpty=(name,sub='Agrega tu primer registro para comenzar.')=>`<div class="empty"><div style="font-size:30px;margin-bottom:6px">⌁</div><strong>${name}</strong>${sub}</div>`;
const chipPhase=p=>`<span class="chip" style="border-color:${phaseColor(p.phase)}66;color:${phaseColor(p.phase)}"><b></b>${phaseName(p.phase)}</span>`;
const users=()=>state.data?.users||[];
const brokers=()=>users().filter(u=>u.role==='broker');
const summarize=()=>{const p=state.data.predios;return{all:p.length,search:p.filter(x=>x.phase===PHASES[0]).length,contact:p.filter(x=>x.phase===PHASES[1]).length,follow:p.filter(x=>x.phase===PHASES[2]).length,close:p.filter(x=>x.phase===PHASES[3]).length,operating:p.filter(x=>x.phase===PHASES[4]).length,pending:state.data.requests.filter(x=>x.status==='pendiente').length}};
function renderDashboard(){
 const z=summarize(),top=state.data.activity.slice(0,6);
 const stageNums=[z.search,z.contact,z.follow,z.close,z.operating];
 return `<div class="dash">${isAdmin()&&z.pending?`<button type="button" class="dash-approvals-alert" data-action="nav" data-view="aprobaciones" aria-label="Ir a aprobaciones: ${z.pending} pendiente${z.pending===1?'':'s'}"><span class="dash-approvals-dot"></span>APROBACIONES<span class="dash-approvals-count">${z.pending}</span><span class="dash-approvals-sub">${z.pending===1?'solicitud pendiente':'solicitudes pendientes'} · revisar →</span></button>`:''}${window.VEOInstall?.shouldOffer()?`<div class="install-strip"><span class="install-strip-ico">📲</span><div><b>Instala VEO en este dispositivo</b><small>Ábrela desde tu pantalla de inicio como una app, sin entrar al navegador.</small></div><button type="button" class="btn btn-primary small" data-action="install-app">INSTALAR</button><button type="button" class="install-strip-close" data-action="install-hide" aria-label="Ocultar invitación">×</button></div>`:''}<div class="hero"><div><div class="eyebrow">VEO TERRITORIOS / EXPANSIÓN DOOH</div><h1>El siguiente gran punto<br/><span class="text-gradient">comienza aquí.</span></h1><p>Del análisis de aforo a un predio viable. Explora los corredores, documenta oportunidades y coordina cada aprobación desde un solo lugar.</p><div class="spaced mt20"><button class="btn btn-ghost" data-action="nav" data-view="mapa" data-map-overview="1">${icon('map')} VER MIS UBICACIONES</button></div></div><div class="hero-right"><div class="hero-focus"><small>COBERTURA METROPOLITANA</small><strong>14</strong><p>Corredores de referencia para prospección en Monterrey y su área metropolitana.</p></div><div class="hero-mini"><i></i> 5 fases · 1 operación conectada</div></div></div>
 <div class="dash-totals"><button type="button" class="dash-total dash-total-pipeline" data-action="nav" data-view="pipeline" aria-label="Ver pipeline: ${fmt(z.search+z.contact+z.follow+z.close)} predios"><small>PIPELINE</small><b>${fmt(z.search+z.contact+z.follow+z.close)}</b><em>${(z.search+z.contact+z.follow+z.close)===1?'predio':'predios'} en fases 1 a 4 · factibilidad a cierre</em><span class="dash-total-go">›</span></button><button type="button" class="dash-total dash-total-operacion" data-action="dash-operating" aria-label="Ver sitios en operación: ${fmt(z.operating)}"><small>SITIOS ESPECTACULARES EN OPERACIÓN</small><b>${fmt(z.operating)}</b><em>${z.operating===1?'sitio':'sitios'} en fase 5 · en operación</em><span class="dash-total-go">›</span></button></div>
 <div class="quickflow" aria-label="Etapas del proceso de adquisición">${['Búsqueda / Factibilidad','Primer contacto','Seguimiento','Cierre','En operación'].map((label,i)=>`<button class="phase-card phase-card-${i+1}" data-action="nav" data-view="pipeline" aria-label="Ver ${E(label)} en pipeline"><span class="flow-number">0${i+1}</span><span class="flow-text"><strong>${label}</strong><small><b class="flow-count">${fmt(stageNums[i])}</b> ${stageNums[i]===1?'predio':'predios'} en etapa</small></span><span class="flow-chevron">›</span></button>`).join('')}</div>
 <div class="dash-row"><section class="panel"><div class="panel-head"><div><h2 class="panel-title">Pulso del pipeline</h2><div class="panel-sub">Distribución actual de las oportunidades</div></div><span class="chip">${z.all} activos</span></div><div class="panel-content">${PHASES.map((p,i)=>`<div class="bar-row"><span class="bar-label"><span class="phase-dot" style="background:${COLORS[i]}"></span>${['Factibilidad','Primer contacto','Seguimiento','Cierre','En operación'][i]}</span><div class="bar-track"><div class="bar-fill" style="background:${COLORS[i]};width:${z.all?Math.max(0,100*stageNums[i]/z.all):0}%"></div></div><b>${stageNums[i]}</b></div>`).join('')}<div class="dash-pending"><div><small>AVANCES POR AUTORIZAR</small><b>${z.pending}</b></div><button class="btn btn-ghost small" data-action="nav" data-view="aprobaciones">REVISAR →</button></div><p class="dash-note">⚑ Contrato firmado no equivale a permiso municipal: sólo es apto para operar con todos los requisitos cumplidos.</p></div></section>
 <section class="panel"><div class="panel-head"><div><h2 class="panel-title">Actividad reciente</h2><div class="panel-sub">Bitácora de movimientos y decisiones</div></div></div><div class="panel-content">${top.length?top.map(a=>`<div class="list-log"><span class="log-circle">↗</span><div><strong>${E(a.detail)}</strong><p>${E(a.user_name||'Usuario')} · ${day(a.created_at)} ${a.code?'· '+E(a.code):''}</p></div></div>`).join(''):listEmpty('Aún no hay movimientos','Los cambios de los expedientes aparecerán aquí.')}</div></section></div>
 <div class="dash-actions" aria-label="Accesos rápidos"><button class="btn btn-ghost" data-action="nav" data-view="predios">${icon('file')} EXPEDIENTES</button><button class="btn btn-ghost" data-action="nav" data-view="brokers">${icon('users')} ${brokers().filter(x=>x.active).length} BROKERS ACTIVOS</button><button class="btn btn-ghost" data-action="nav" data-view="aprobaciones">✓ APROBACIONES${z.pending?` (${z.pending})`:''}</button><button class="btn btn-ghost" data-action="open-command">⌕ BUSCAR</button>${window.VEOInstall&&!window.VEOInstall.standalone()?'<button class="btn btn-ghost" data-action="install-app">📲 INSTALAR APP</button>':''}</div></div>`;
}
function filteredPredios(){return state.data.predios.filter(p=>(!state.selectedCorridor||p.corridor_id==state.selectedCorridor)&&(!state.phaseFilter||p.phase===state.phaseFilter)&&(!state.brokerFilter||p.broker_id==state.brokerFilter)&&(!state.search||[p.code,p.alias,cname(p.corridor_id),p.direccion,p.municipio].join(' ').toLowerCase().includes(state.search.toLowerCase())))}
const selectCorridors=(value=0)=>`<option value="0" ${!value?'selected':''}>Todos los corredores (${state.data.corridors.length})</option>${state.data.corridors.map(c=>`<option value="${c.id}" ${+value===c.id?'selected':''}>${String(c.id).padStart(2,'0')} · ${E(c.name)}</option>`).join('')}`;
const selectPhases=(value='')=>`<option value="" ${!value?'selected':''}>Todas las fases</option>${PHASES.map((p,i)=>`<option ${value===p?'selected':''} value="${p}">${PHASELABEL[i]}</option>`).join('')}`;
const selectBrokers=(value='')=>`<option value="" ${!value?'selected':''}>Todos los brokers</option>${brokers().map(u=>`<option ${+value===u.id?'selected':''} value="${u.id}">${E(u.display_name)}</option>`).join('')}`;
// Expedientes en tarjetas compactas: ID, nombre, fase y corredor; color según la fase.
function predioRows(p){
 // Ordenados por etapa (fase 1 → En operación) y, dentro de cada etapa, por ID; con encabezado por etapa.
 const fase=x=>Math.max(0,PHASES.indexOf(x.phase));
 const sorted=p.slice().sort((a,b)=>fase(a)-fase(b)||String(a.code).localeCompare(String(b.code)));
 let last=-1;
 return sorted.length?sorted.map(x=>{const n=fase(x)+1;let head='';if(n!==last){last=n;const c=sorted.filter(y=>fase(y)+1===n).length;head=`<div class="predio-group-head phase-head-${n}"><span>0${n}</span>${E(phaseName(x.phase))}<b>${c}</b></div>`}return head+`<button type="button" class="predio-tile phase-tile-${n}" data-action="open-predio" data-id="${x.id}" aria-label="Abrir expediente ${E(x.code)} · ${E(x.alias)}"><span class="predio-tile-top"><span class="predio-tile-id">${E(x.code)}</span><span class="predio-tile-phase">${E(phaseName(x.phase))}</span></span><strong class="predio-tile-name">${E(x.alias)}</strong><span class="predio-tile-corr">${E(cname(x.corridor_id))}</span></button>`}).join(''):`<div class="predio-tiles-empty">${listEmpty('Sin resultados','Cambia los filtros o crea un expediente nuevo.')}</div>`}
function updatePredioRows(){if(state.view!=='predios')return;const p=filteredPredios();const rows=document.getElementById('predios-rows'),label=document.getElementById('predios-count');if(rows)rows.innerHTML=predioRows(p);if(label)label.textContent=`${p.length} ubicaciones visibles`}
function renderPredios(){const p=filteredPredios();return title('INVENTARIO DE OPORTUNIDADES','Expedientes de predios','Gestión documental, responsable, calificación y avance por ubicación.',`${isManager()&&!demo?'<a href="/api/export.csv" class="btn btn-ghost">EXPORTAR CSV</a>':''}${isManager()?'<button class="btn btn-ghost" data-action="view-archives">ARCHIVADOS</button>':''}`)+`<div class="panel"><div class="panel-head"><div><h2 class="panel-title" id="predios-count">${p.length} ubicaciones visibles</h2><div class="panel-sub">Encuentra un expediente sin salir de la pantalla</div></div></div><div class="panel-content"><div class="filter-row"><input id="search-predios" type="search" aria-label="Buscar predios" class="field" style="flex:1;min-width:190px" placeholder="Buscar ID, avenida, predio o municipio…" value="${E(state.search)}" /><select class="field" style="max-width:225px" data-change="corridor">${selectCorridors(state.selectedCorridor)}</select><select class="field" style="max-width:225px" data-change="phase">${selectPhases(state.phaseFilter)}</select>${state.user.role==='broker'?'':`<select class="field" style="max-width:200px" data-change="broker">${selectBrokers(state.brokerFilter)}</select>`}<button class="btn btn-ghost small" data-action="clear-filters">LIMPIAR</button></div><div class="predio-tiles" id="predios-rows">${predioRows(p)}</div></div></div>`}
function renderPipeline(){return title('PROCESO DE ADQUISICIÓN','Pipeline de ubicaciones','Cada cambio de etapa requiere evidencia completa y aprobación de un supervisor.',``)+`<div class="stage-grid">${PHASES.map((stage,i)=>{const items=state.data.predios.filter(p=>p.phase===stage);return `<div class="stage-col"><div class="stage-head"><h3 style="color:${COLORS[i]}">${PHASELABEL[i]}</h3><strong>${items.length}</strong></div><p class="micro">${['Captura, fotos, satélite y puntuación (dron opcional)','Dueño / administrador y contacto inicial','Carta de intención y negociación','Contrato sujeto a permiso y expediente técnico','Fotos y videos del sitio operando'][i]}</p>${items.map(p=>`<div class="property-card" data-action="open-predio" data-id="${p.id}"><div class="code">${E(p.code)}</div><h3>${E(p.alias)}</h3><p>${E(cname(p.corridor_id))}</p><p>◉ ${E(p.broker_name||'Sin asignar')}</p><div class="property-foot"><span class="grade">${p.score}<span style="font-size:9px">/100</span></span><span class="chip">${p.docs_count||0} docs</span></div>${p.pending_count?'<p style="color:#ffce89">◷ Avance solicitado</p>':''}</div>`).join('')}${!items.length?`<div class="empty" style="margin-top:20px">No hay ubicaciones en esta etapa.</div>`:''}</div>`}).join('')}</div>`}
function renderApprovals(){const req=state.data.requests.filter(r=>r.status==='pendiente');return title('CONTROL DE CREDENCIALES','Solicitudes de aprobación','Los brokers proponen avances; el supervisor o administrador autoriza sólo cuando los requisitos se cumplen.')+`<div class="split"><section class="panel"><div class="panel-head"><div><h2 class="panel-title">Pendientes de resolución</h2><div class="panel-sub">${req.length} solicitud(es)</div></div></div><div class="panel-content">${req.length?req.map(r=>`<div class="list-log"><div class="log-circle">↗</div><div style="flex:1"><strong>${E(r.code)} · ${E(r.alias)}</strong><p>${E(phaseName(r.from_phase))} → <b>${E(phaseName(r.to_phase))}</b><br/>Solicitó: ${E(r.requester_name)} · ${day(r.created_at)} ${r.reason?' · '+E(r.reason):''}</p><div class="spaced mt12"><button class="btn btn-ghost small" data-action="open-predio" data-id="${r.predio_id}">VER EXPEDIENTE</button>${isManager()?`<button class="btn btn-cyan small" data-action="resolve" data-id="${r.id}" data-decision="aprobada">APROBAR</button><button class="btn btn-danger small" data-action="resolve" data-id="${r.id}" data-decision="rechazada">RECHAZAR</button>`:''}</div></div></div>`).join(''):listEmpty('Sin aprobaciones pendientes','El área de supervisión recibirá las solicitudes de avance aquí.')}</div></section><section class="panel"><div class="panel-head"><h2 class="panel-title">Reglas de avance</h2></div><div class="panel-content">${['01 · FACTIBILIDAD → CONTACTO: pin, foto, satélite, broker y score ≥70 (video con dron opcional).','02 · CONTACTO → SEGUIMIENTO: contacto identificado, datos, fecha, respuesta y recibo de pago del predial.','03 · SEGUIMIENTO → CIERRE: carta de intención, interés confirmado y condición de permiso explicada.','04 · CIERRE → EN OPERACIÓN: contrato + memoria de cálculo + factibilidad eléctrica + evidencia de programa de obra + permiso municipal autorizado (mecánica de suelos opcional).','05 · EN OPERACIÓN: fotos y videos del sitio funcionando.'].map(x=>`<div class="list-log"><div class="log-circle">✓</div><div><p style="font-size:12px;margin:2px 0">${E(x)}</p></div></div>`).join('')}<div class="alert-box warn mt20">⚑ <span><b>Alerta legal:</b> subir un contrato no implica que esté vigente para operar. Su efectividad está condicionada a la autorización municipal, según el criterio de la operación.</span></div></div></section></div>`}
function renderBrokers(){const b=brokers();return title('EQUIPO DE ADQUISICIÓN','Brokers registrados','Asigna responsables, conserva el historial de bajas y gestiona sus permisos de acceso.',isAdmin()?'<button class="btn btn-primary" data-action="new-user">＋ ALTA DE BROKER / USUARIO</button>':'')+`<div class="brokers">${b.map(u=>{let p=state.data.predios.filter(x=>x.broker_id===u.id);return `<div class="broker-card"><div class="spaced"><span class="avatar">${E(initials(u.display_name))}</span><div><div class="name">${E(u.display_name)}</div><div class="role">@${E(u.username)} · ${u.active?'ACTIVO':'INACTIVO'}</div></div></div><div class="stats"><div><b>${p.length}</b><small>Predios</small></div><div><b>${p.filter(x=>x.phase===PHASES[3]).length}</b><small>En cierre</small></div><div><b>${p.length?Math.round(p.reduce((s,x)=>s+x.score,0)/p.length):0}</b><small>Score medio</small></div></div>${isAdmin()?`<div class="spaced mt20"><button class="btn btn-ghost small" data-action="edit-user" data-id="${u.id}">GESTIONAR CUENTA</button>${u.active?`<button class="btn btn-danger small" data-action="deactivate-broker" data-id="${u.id}">DAR DE BAJA</button>`:`<button class="btn btn-ghost small" data-action="reactivate-broker" data-id="${u.id}">REACTIVAR</button>`}</div>`:''}</div>`}).join('')}${!b.length?listEmpty('Sin brokers registrados'):''}</div><section class="panel mt20"><div class="panel-head"><h2 class="panel-title">Matriz de autorizaciones</h2></div><div class="panel-content"><div class="table-wrap"><table class="data-table"><thead><tr><th>ROL</th><th>ALTA DE PREDIOS</th><th>EDITAR / EVIDENCIA</th><th>SOLICITAR AVANCE</th><th>APROBAR FASES</th><th>USUARIOS / CREDENCIALES</th></tr></thead><tbody>${[['Broker','✓ propios','✓ asignados','✓','—','—'],['Supervisor','✓','✓ todos','✓','✓','—'],['Legal','—','✓ documental / permisos','—','—','—'],['Técnico','—','✓ documentos técnicos','—','—','—'],['Administrador','✓','✓ todos','✓','✓','✓']].map(a=>`<tr>${a.map(v=>`<td>${E(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div></section>`}
function renderCredentials(){
 if(!isAdmin())return title('ACCESO RESTRINGIDO','Credenciales','Disponible sólo para administradores.');
 const accounts=users();
 return title('ADMINISTRACIÓN DE ACCESOS','Credenciales y usuarios','Crear cuentas, restablecer contraseñas temporales y administrar la baja sin borrar expedientes.',`<button class="btn btn-primary" data-action="new-user">＋ CREAR USUARIO</button>`)+
 `<div class="alert-box mt12"><span>🔐</span><div><b>Contraseñas privadas:</b> al crear o restablecer una cuenta el usuario debe cambiar su contraseña temporal en el primer acceso. El Administrador ve la fecha y estado del cambio, <b>nunca la contraseña privada.</b></div></div>`+
 `<section class="panel mt20"><div class="panel-head"><div><h2 class="panel-title">Cuentas de acceso</h2><div class="panel-sub">${accounts.filter(u=>u.active).length} activas · ${accounts.filter(u=>!u.active).length} dadas de baja</div></div><button class="btn btn-ghost small" data-action="my-password">CAMBIAR MI CONTRASEÑA</button></div><div class="table-wrap"><table class="data-table responsive-cards credential-cards"><thead><tr><th>USUARIO</th><th>ROL</th><th>CUENTA</th><th>CONTRASEÑA</th><th>ÚLTIMO CAMBIO</th><th>ACCIONES</th></tr></thead><tbody>${accounts.map(u=>`<tr><td data-label="Usuario"><div class="record-primary"><strong>${E(u.display_name)}</strong><br/><span class="muted">@${E(u.username)}</span></div></td><td data-label="Rol">${E(u.role.toUpperCase())}</td><td data-label="Cuenta"><span class="account-state ${u.active?'is-active':'is-disabled'}">${u.active?'ACTIVA':'DADA DE BAJA'}</span></td><td data-label="Contraseña"><span class="account-state ${u.must_change_password?'is-pending':'is-active'}">${u.must_change_password?'CAMBIO OBLIGATORIO':'PERSONALIZADA'}</span></td><td data-label="Último cambio">${u.password_changed_at?day(u.password_changed_at):'Pendiente de primer cambio'}</td><td data-label="Acciones"><div class="spaced">${u.id===state.user.id?`<button class="btn btn-ghost small" data-action="my-password">MI CONTRASEÑA</button>`:`<button class="btn btn-ghost small" data-action="edit-user" data-id="${u.id}">GESTIONAR / RESETEAR</button>`}${u.role==='broker'&&u.active?`<button class="btn btn-danger small" data-action="deactivate-broker" data-id="${u.id}">DAR DE BAJA</button>`:u.role==='broker'&&!u.active?`<button class="btn btn-ghost small" data-action="reactivate-broker" data-id="${u.id}">REACTIVAR</button>`:''}</div></td></tr>`).join('')}</tbody></table></div></section>`+
 `<section class="panel mt20"><div class="panel-head"><h2 class="panel-title">Protección del historial</h2></div><div class="panel-content"><p class="source-footnote">Dar de baja a un broker cierra sus sesiones y lo retira del selector de nuevos predios. No se elimina ningún predio, evidencia, comentario o movimiento histórico, y puede reactivarse si es necesario.</p></div></section>`;
}
function renderSources(){
 const corridors=state.data.corridors.filter(hasSheet).sort((a,b)=>a.id-b.id);
 return title('INTELIGENCIA VIAL','Fichas de aforo vehicular','Consulta las 14 fichas originales por corredor. Toca cualquier lámina para ampliarla y revisar el mapa, intersecciones y estimaciones desde tu celular o tablet.')+`
 <section class="veo-aforo-library" aria-label="Fichas de aforo de los corredores">
  <div class="veo-aforo-library-top">
   <div class="veo-aforo-library-count"><span class="veo-aforo-library-icon">▦</span><div><strong>Estudio VEO · noviembre 2026</strong><small><span id="veo-aforo-visible-count">14</span> de 14 fichas de aforo disponibles</small></div></div>
   <label class="veo-aforo-search-field"><span aria-hidden="true">⌕</span><input type="search" id="veo-aforo-search" placeholder="Buscar corredor o intersección…" autocomplete="off" aria-label="Buscar fichas por avenida o intersección" oninput="filtrarFichasAforo(this.value)" /></label>
  </div>
  <div class="veo-aforo-library-grid" id="veo-aforo-library-grid">${corridors.map(x=>`
   <article class="veo-aforo-tile" data-aforo-texto="${E((x.name+' '+x.candidate_node+' '+x.code+' '+x.id).toLowerCase())}">
    <button type="button" class="veo-aforo-preview" data-action="open-sheet" data-id="${x.id}" aria-label="Ampliar ficha de aforo de ${E(x.name)}">
      <img src="${refImage(x,'sheet')}" alt="Lámina ${x.page}: aforo vehicular de ${E(x.name)}" loading="lazy" decoding="async" />
      <span class="veo-aforo-preview-overlay">⌕ AMPLIAR FICHA</span>
    </button>
    <div class="veo-aforo-tile-body">
      <div class="veo-aforo-tile-meta"><span>CORREDOR ${String(x.id).padStart(2,'0')}</span><span>LÁMINA ${x.page} / 18</span></div>
      <h3>${E(x.name)}</h3>
      <p class="veo-aforo-node"><b>Intersección destacada:</b> ${E(x.candidate_node)}</p>
      <div class="veo-aforo-tile-data"><span>Aforo del capítulo</span><strong>${E(x.aforo_detail)} <small>veh/día</small></strong></div>
      <div class="veo-aforo-tile-actions"><button type="button" class="btn btn-primary" data-action="open-sheet" data-id="${x.id}">VER FICHA DE AFORO ↗</button><button type="button" class="btn btn-ghost" data-action="show-corridor" data-id="${x.id}">VER MAPA</button></div>
    </div>
   </article>`).join('')}</div>
  <div class="veo-aforo-empty" id="veo-aforo-empty" hidden>No encontramos una ficha con ese nombre. Prueba otra avenida o intersección.</div>
 </section>
 <div class="alert-box mt20"><span>ⓘ</span><span>Las láminas son reproducciones del informe original. Incluyen estimaciones, referencias históricas y modelos, no aforos certificados por predio. Algunas cifras difieren del resumen de conveniencia; se conservan sin modificarlas.</span></div>`;
}
function filtrarFichasAforo(value){
 const normalized=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 let count=0;
 document.querySelectorAll('#veo-aforo-library-grid .veo-aforo-tile').forEach(card=>{
  const text=(card.dataset.aforoTexto||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const shown=!normalized||text.includes(normalized);card.hidden=!shown;if(shown)count++;
 });
 const counter=document.getElementById('veo-aforo-visible-count');if(counter)counter.textContent=String(count);
 const empty=document.getElementById('veo-aforo-empty');if(empty)empty.hidden=count!==0;
}
function renderConfig(){return title('SISTEMA · CUMPLIMIENTO','Reglas de adquisición','Parámetros y políticas del seguimiento de predios.')+`<div class="split-even"><section class="panel"><div class="panel-head"><h2 class="panel-title">Fases administradas</h2></div><div class="panel-content">${PHASES.map((p,i)=>`<div class="list-log"><div class="log-circle" style="color:${COLORS[i]}">${i+1}</div><div><strong>${PHASELABEL[i]}</strong><p>${['Levantamiento de evidencia y puntuación.','Primer contacto y calificación de intención.','Oferta formal con carta de intención.','Contrato condicionado, ingeniería y permisos.','Sitio operando: fotos y videos de lo cerrado.'][i]}</p></div></div>`).join('')}</div></section><section class="panel"><div class="panel-head"><h2 class="panel-title">Calificación ponderada /100</h2></div><div class="panel-content">${Object.entries(WEIGHTS).map(([k,v])=>`<div class="bar-row"><span class="bar-label">${E(RATINGLABEL[k])}</span><div class="bar-track"><div class="bar-fill" style="width:${v*2}%;background:#23cddd"></div></div><b>${v}%</b></div>`).join('')}<p class="source-footnote mt20">Umbral de ejemplo para solicitar primer avance: 70 puntos. La calificación es la valoración interna del broker, no una certificación de aforo o viabilidad legal.</p></div></section></div><div class="panel mt20"><div class="panel-head"><h2 class="panel-title">Condición suspensiva del contrato</h2></div><div class="panel-content"><div class="alert-box warn"><span>⚖</span><div><b>Regla indispensable:</b> el contrato de ocupación o arrendamiento debe sujetar sus efectos y la posibilidad de operar al permiso municipal aplicable. El dashboard distingue "en cierre" de "apto para operar". El texto contractual definitivo debe ser revisado por el área jurídica y la autoridad municipal competente.</div></div><p class="source-footnote mt20">${demo?'Los registros de esta edición se guardan en este navegador; no utilizarla con información confidencial.':'Los archivos se almacenan en un servicio privado y el control de acceso se valida en la API. Mantén respaldos periódicos y sesiones individuales.'}</p></div></div>`}
const hasSheet=c=>!!window.VEO_DEMO_IMAGES?.sheet?.[String(c.id).padStart(2,'0')];
function refImage(c,kind='map'){const id=String(c.id).padStart(2,'0');return window.VEO_DEMO_IMAGES?.[kind]?.[id]|| (kind==='map'?`/assets/mapa_${id}.jpg`:`/assets/lamina_${id}.jpg`)}

// Consultas y enlaces de Google Maps. No se inventan coordenadas para los nodos del estudio.
function googleQuery(c){return c?`${c.candidate_node}, ${c.name}, Nuevo León, México`:'Monterrey, Nuevo León, México'}
function googleEmbedUrl(c){
 const q=encodeURIComponent(googleQuery(c));
 // Integración oficial documentada, al habilitar VEO_GOOGLE_MAPS_EMBED_KEY en el servidor.
 const key=state.data?.maps_embed_key||window.VEO_GOOGLE_MAPS_EMBED_KEY||'';
 if(key)return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${q}&zoom=14&maptype=roadmap&language=es`;
 // Vista pública de Google Maps por búsqueda. Puede estar limitada por Google; el enlace oficial siempre está disponible.
 return `https://maps.google.com/maps?q=${q}&t=m&z=14&output=embed`;
}
function googleMapFrame(c,cssClass=''){
 const url=E(googleEmbedUrl(c));const lazy=cssClass==='source-google-iframe';
 return `<iframe class="google-map-iframe ${cssClass}" ${lazy?`data-map-src="${url}"`:`src="${url}"`} title="Google Maps: ${E(c?.name||'Monterrey')}" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}
// Enlace directo a Google Maps por coordenadas del pin; no necesita API ni permisos del usuario.
function googlePinUrl(lat,lng){
 const point=normalizePoint(lat,lng);
 if(!point)return '';
 return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(point.lat.toFixed(7)+','+point.lng.toFixed(7));
}
function googlePinLink(lat,lng,label='VER EN GOOGLE MAPS',cls='btn btn-ghost small'){
 const href=googlePinUrl(lat,lng);
 return href?`<a class="${cls}" href="${href}" target="_blank" rel="noopener noreferrer" title="Abrir la ubicación GPS en Google Maps (pestaña nueva)">${label} ↗</a>`:'';
}
function opportunityPins(){return filteredPredios().filter(p=>p.lat!=null&&p.lng!=null&&Number.isFinite(+p.lat)&&Number.isFinite(+p.lng)&&Math.abs(+p.lat)<=90&&Math.abs(+p.lng)<=180)}
function mapOpportunityList(items){return items.length?items.map(p=>`<div class="opportunity-entry-row"><button class="opportunity-entry" type="button" data-action="locate-opportunity" data-id="${p.id}"><span class="opportunity-dot" style="background:${phaseColor(p.phase)}"></span><span class="opportunity-entry-info"><strong>${E(p.alias)}</strong><small>${E(p.code)} · ${E(cname(p.corridor_id))}</small><small>${E(phaseName(p.phase))}</small></span><span class="opportunity-entry-arrow">⌖</span></button>${googlePinLink(p.lat,p.lng,'GOOGLE MAPS','opportunity-google-link')}</div>`).join(''):'<div class="opportunity-empty">Aún no hay predios con coordenadas en este filtro. Los predios sin pin se muestran en Expedientes.</div>'}

function renderMap(){
 state.base='streets';state.mapProvider='veo';
 const p=filteredPredios(),pins=opportunityPins(),selected=state.selectedCorridor?corridor(state.selectedCorridor):pins.length?corridor(pins[0].corridor_id):state.data.corridors.find(x=>x.report_rank===1);
 const allGeo=state.data.predios.filter(x=>x.lat!=null&&x.lng!=null).length,missing=p.length-pins.length;
 const workMap=`<div id="opportunities-map" class="opportunity-native-map" role="application" aria-label="Mapa de oportunidades orientado al norte, con corredores y pines de predios registrados"></div><div class="veo-north-indicator" role="img" aria-label="Orientación: norte hacia arriba" title="Norte · mapa orientado hacia arriba"><span>N</span><svg viewBox="0 0 32 44" aria-hidden="true"><path d="M16 3 L27 31 L16 25 L5 31 Z" fill="#fb4979" stroke="#f5fbff" stroke-width="1.5"/><path d="M16 3 V39" stroke="#f5fbff" stroke-width="1.5" opacity=".7"/></svg></div><div class="map-overlay-top"><span class="chip" style="background:#0c203bea;border-color:#3e6a8a;color:#c2eafa">● ${pins.length} PREDIOS CON PIN</span><span class="streets-only-chip">▣ MONTERREY · AMM</span></div>`;

 return `<div class="mapa-page">`+title('GIS · PROSPECCIÓN TERRITORIAL','Mapa de oportunidades','Vista general de Monterrey y su área metropolitana. Selecciona un corredor para enfocarlo o consulta los pines guardados.',``)
 +`<div class="filter-row"><button type="button" class="btn btn-ghost small metro-overview-btn" data-action="metro-overview" title="Centrar vista completa de Monterrey y el área metropolitana">⌖ VISTA MONTERREY · AMM</button><select class="field" style="max-width:255px" data-change="corridor">${selectCorridors(state.selectedCorridor)}</select><select class="field" style="max-width:220px" data-change="phase">${selectPhases(state.phaseFilter)}</select>${state.user.role==='broker'?'':`<select class="field" style="max-width:205px" data-change="broker">${selectBrokers(state.brokerFilter)}</select>`}<button class="btn btn-ghost small" data-action="clear-filters">LIMPIAR FILTROS</button><span class="chip">${pins.length} de ${allGeo} pines visibles</span><span class="streets-only-chip">CALLES · PINES VEO</span></div>`
 +`<div class="map-layout map-layout-metropolitana"><div class="map-wrap">${workMap}</div><div class="map-side"><section class="panel"><div class="panel-head"><div><h2 class="panel-title">Predios georreferenciados</h2><div class="panel-sub">Haz clic para localizar y abrir el expediente</div></div><span class="chip">${pins.length} visibles</span></div><div class="panel-content"><div class="opportunity-list">${mapOpportunityList(pins)}</div>${missing?`<div class="opportunity-missing">${missing} ${missing===1?'predio pendiente':'predios pendientes'} de ubicar en este filtro. <button class="link-btn" data-action="nav" data-view="predios">VER EXPEDIENTES →</button></div>`:''}<div class="opportunity-legend">${PHASES.map((stage,i)=>`<span><i style="background:${COLORS[i]}"></i>${['Factibilidad','Primer contacto','Seguimiento','Cierre','En operación'][i]}</span>`).join('')}</div></div></section><section class="panel"><div class="panel-head"><div><h2 class="panel-title">Corredor de referencia</h2><div class="panel-sub">Datos del reporte VEO · noviembre 2026</div></div></div><div class="panel-content"><h3 style="font-size:15px;margin:4px 0 8px">${E(selected.name)}</h3><p class="source-footnote">${E(selected.candidate_node)} · referencia orientativa, no ubicación asignada</p>${hasSheet(selected)?`<button class="btn btn-ghost small" data-action="open-sheet" data-id="${selected.id}">VER FICHA DE AFORO</button>`:'<p class="source-footnote">Corredor sin ficha de aforo del estudio original.</p>'}</div></section></div></div></div>`;
}
function corridorLabel(id){const c=corridor(id);return c?`Corredor ${String(c.id).padStart(2,'0')} · ${c.name}`:''}
function photoMarkers(pins){const byId=new Map(pins.map(p=>[p.id,p]));return (state.data.photos||[]).filter(f=>byId.has(f.predio_id)&&Number.isFinite(+f.lat)&&Number.isFinite(+f.lng)).map(f=>{const p=byId.get(f.predio_id);return{key:'foto-'+f.id,kind:'foto',id:p.id,lat:+f.lat,lng:+f.lng,color:phaseColor(p.phase),name:'📷 '+(f.filename||'Foto'),code:'Foto de '+p.code+' · '+(f.source==='exif'?'GPS de la foto':'Ubicación del dispositivo'),googleUrl:googlePinUrl(f.lat,f.lng),media:f.media||[],corridorName:corridorLabel(p.corridor_id),label:'Foto de '+p.code+' · '+p.alias}})}
function closeMap(){state.routeToken=(state.routeToken||0)+1;if(state.map){try{state.map.remove()}catch(e){}state.map=null;state.tileLayer=null;state.markers=null}}
async function initMap(){const el=document.getElementById('opportunities-map');if(!el)return;closeMap();const pins=opportunityPins();if(!window.VEOMapNative){el.innerHTML='<div class="opportunity-empty">No se pudo abrir el visor. Actualiza la aplicación.</div>';return}
 // Vista inicial metropolitana fija: nunca centrar sólo un predio registrado.
 // Este rectángulo es una referencia visual amplia del AMM (no límite administrativo).
 const metroBounds={south:25.47,west:-100.64,north:25.96,east:-100.03};
 let center=[25.6866,-100.3161],z=10;
 if(state.selectedCorridor&&CORRIDOR_FOCUS[state.selectedCorridor]){
  const view=CORRIDOR_FOCUS[state.selectedCorridor];center=[view[0],view[1]];z=view[2];
 }
 const gkey=googleMapsJSKey();let MapClass=window.VEOMapNative;
 if(gkey&&window.VEOGoogleMap){try{await loadGoogleMapsJS(gkey);MapClass=window.VEOGoogleMap}catch(e){console.warn('Google Maps no disponible; se usa el mapa VEO.',e.message)}}
 if(!el.isConnected)return;
 state.map=new MapClass(el,{center,zoom:z,mode:'streets',markers:pins.map(p=>({id:p.id,lat:+p.lat,lng:+p.lng,color:phaseColor(p.phase),name:p.alias,code:p.code,phase:phaseName(p.phase),googleUrl:googlePinUrl(p.lat,p.lng),media:p.media||[],corridorName:corridorLabel(p.corridor_id),label:`${p.code} · ${p.alias} · ${phaseName(p.phase)}`})).concat(photoMarkers(pins)),onMarker:id=>openPredio(id)});
 // Una selección debe mostrar la mayor longitud posible, no solo la intersección guía.
 // Si hay trazado OSM en memoria se usa inmediatamente; si aún no, mostrar el
 // área orientativa y reajustar al eje real cuando llegue la geometría.
 if(state.selectedCorridor){
  const cachedShape=window.VEORoutes?.cached?.(state.selectedCorridor);
  const area=routeGeoBounds(cachedShape?.lines)||indicativeCorridorBounds(state.selectedCorridor);
  if(area)state.map.fitBounds(area,{padding:{x:46,y:78},maxZoom:15,animate:false});
 }else{
  state.map.fitBounds(metroBounds,{padding:{x:20,y:30},maxZoom:11,animate:false});
 }
 highlightOpportunityCorridor(state.map,state.selectedCorridor);
}
window.veoOpen=id=>openPredio(id);
window.veoReloadMap=()=>{if(state.view==='mapa')initMap()};
function setTileLayer(){if(state.map?.setMode)state.map.setMode('streets')}
async function searchNode(id){const c=corridor(id);if(!c||!state.map)return;let view=CORRIDOR_FOCUS?.[id];if(view){state.map.flyTo([view[0],view[1]],view[2]);toast('Ubicación orientativa del corredor; no representa un predio.')}else toast('No se encontró el sector de referencia.',true)}
let aforoZoomActual=100;
function aforoEscala(pct,inicial=false){
  const lienzo=document.getElementById('aforo-lienzo');
  const imagen=document.getElementById('aforo-imagen');
  if(!lienzo||!imagen)return;
  const anteriorAncho=lienzo.scrollWidth||1, anteriorAlto=lienzo.scrollHeight||1;
  const rx=(lienzo.scrollLeft+lienzo.clientWidth/2)/anteriorAncho;
  const ry=(lienzo.scrollTop+lienzo.clientHeight/2)/anteriorAlto;
  aforoZoomActual=Math.max(100,Math.min(300,Math.round(pct)));
  imagen.style.width=aforoZoomActual+'%';
  const porcentaje=document.getElementById('aforo-nivel');
  if(porcentaje)porcentaje.textContent=aforoZoomActual+'%';
  const ajustar=document.getElementById('aforo-ajustar');
  if(ajustar)ajustar.classList.toggle('active',aforoZoomActual===100);
  requestAnimationFrame(()=>{
    if(!lienzo.isConnected)return;
    lienzo.scrollLeft=inicial?Math.max(0,(lienzo.scrollWidth-lienzo.clientWidth)/2):Math.max(0,rx*lienzo.scrollWidth-lienzo.clientWidth/2);
    lienzo.scrollTop=inicial?0:Math.max(0,ry*lienzo.scrollHeight-lienzo.clientHeight/2);
  });
}
function mostrarAforo(id){
  const c=corridor(id);if(!c)return;
  document.getElementById('modal').innerHTML=`<section class="modal-box aforo-modal" role="dialog" aria-modal="true" aria-label="Ficha de aforo ${E(c.name)}">
    <header class="aforo-header">
      <div class="aforo-titulo"><small>ESTUDIO DE AFORO · LÁMINA ${c.page} DE 18</small><h2>${E(c.name)}</h2></div>
      <div class="aforo-acciones">
        <div class="aforo-controles" role="group" aria-label="Escala de la ficha">
          <button type="button" class="aforo-control" data-action="aforo-minus" aria-label="Reducir tamaño">−</button>
          <span id="aforo-nivel" class="aforo-porcentaje">100%</span>
          <button type="button" class="aforo-control" data-action="aforo-plus" aria-label="Ampliar tamaño">+</button>
          <button type="button" class="aforo-control aforo-ajustar" id="aforo-ajustar" data-action="aforo-fit" title="Ver ficha completa">AJUSTAR</button>
          <button type="button" class="aforo-control aforo-doble" data-action="aforo-double" title="Ver al doble de tamaño">2×</button>
        </div>
        <button class="icon-btn aforo-cerrar" data-action="close-modal" aria-label="Cerrar ficha">×</button>
      </div>
    </header>
    <div class="aforo-scroll" id="aforo-lienzo" tabindex="0" aria-label="Lámina de aforo ampliada; desliza para desplazarte">
      <img id="aforo-imagen" src="${refImage(c,'sheet')}" alt="Ficha de aforo ${E(c.name)}" draggable="false" />
    </div>
    <footer class="aforo-pie">
      <span>Imagen del estudio original. Sus aforos son estimaciones y no indican coordenadas exactas de predios.</span>
      <span class="aforo-ayuda">Desliza para recorrer la lámina · Amplía hasta 300%</span>

    </footer>
  </section>`;
  const lienzo=document.getElementById('aforo-lienzo');
  const imagen=document.getElementById('aforo-imagen');
  aforoEscala(100,true);
  imagen.addEventListener('load',()=>aforoEscala(aforoZoomActual,true),{once:true});
  let inicio=null;
  lienzo.addEventListener('pointerdown',(ev)=>{
    if(ev.pointerType==='touch'||ev.button!==0)return;
    inicio={x:ev.clientX,y:ev.clientY,izq:lienzo.scrollLeft,arriba:lienzo.scrollTop};
    lienzo.setPointerCapture(ev.pointerId);
    lienzo.classList.add('aforo-arrastrando');
  });
  lienzo.addEventListener('pointermove',(ev)=>{
    if(!inicio)return;
    lienzo.scrollLeft=inicio.izq-(ev.clientX-inicio.x);
    lienzo.scrollTop=inicio.arriba-(ev.clientY-inicio.y);
  });
  const soltar=()=>{inicio=null;lienzo.classList.remove('aforo-arrastrando')};
  lienzo.addEventListener('pointerup',soltar);
  lienzo.addEventListener('pointercancel',soltar);
  lienzo.addEventListener('lostpointercapture',soltar);
}
function showSheet(id){mostrarAforo(id)}
function locationEntryFields(origin,lat,lng){
 const disabled=origin==='edit'&&!state.drawer?.can_edit;
 const coordinate=(which,label,value)=>`<div class="field-group"><label class="field-label" for="${origin}-${which}">${label} · clic para ubicar</label><div class="location-control"><input id="${origin}-${which}" class="field location-input" type="text" name="${which}" value="${E(value??'')}" placeholder="⌖ Seleccionar en mapa" readonly ${disabled?'disabled':''} data-action="pick-location" data-origin="${origin}" aria-label="Elegir ${label} sobre mapa de calles" title="Haz clic para marcar un pin sobre el mapa"/><button type="button" class="location-map-btn" data-action="pick-location" data-origin="${origin}" aria-label="Abrir mapa para ${label}" ${disabled?'disabled':''}>${icon('pin')}</button></div></div>`;
 return coordinate('lat','Latitud',lat)+coordinate('lng','Longitud',lng);
}
// Instrucciones para instalar la app (iPhone/iPad no permiten instalar con un botón)
function showInstallHelp(){
 const ios=window.VEOInstall?.isIOS;
 const share='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
 const steps=ios?[`Abre <b>veocrm.vercel.app</b> en <b>Safari</b>.`,`Toca el botón <b>Compartir</b> ${share} (abajo en iPhone, arriba a la derecha en iPad).`,`Elige <b>«Agregar a inicio»</b> y toca <b>Agregar</b>.`,`Abre VEO desde el ícono de tu pantalla de inicio.`]
  :[`Abre <b>veocrm.vercel.app</b> en <b>Chrome</b>.`,`Toca el menú <b>⋮</b> (arriba a la derecha).`,`Elige <b>«Instalar app»</b> o <b>«Agregar a pantalla principal»</b>.`,`Abre VEO desde el ícono de tu pantalla de inicio.`];
 document.getElementById('modal').innerHTML=`<div class="modal-box install-modal"><div class="modal-top"><div><small>APP EN TU DISPOSITIVO</small><h2>Instalar VEO</h2></div><button class="icon-btn" type="button" data-action="close-modal" aria-label="Cerrar">×</button></div><p class="subhead">Se agrega como acceso directo con el ícono de VEO y se abre a pantalla completa, sin barra del navegador. No se publica en tiendas.</p><ol class="install-steps">${steps.map(x=>`<li>${x}</li>`).join('')}</ol><div class="spaced mt20" style="justify-content:flex-end"><button type="button" class="btn btn-primary" data-action="close-modal">ENTENDIDO</button></div></div>`;
}
// Rechazo de cambio de fase: el motivo es obligatorio y se guarda en la bitácora.
function showRejectDialog(id){
 const r=(state.data?.requests||[]).find(x=>+x.id===+id);
 document.getElementById('modal').innerHTML=`<div class="modal-box reject-modal"><div class="modal-top"><div><small>RECHAZAR CAMBIO DE FASE</small><h2>${r?E(r.code)+' · '+E(r.alias):'Solicitud de avance'}</h2></div><button class="icon-btn" type="button" data-action="close-modal" aria-label="Cerrar">×</button></div>${r?`<p class="subhead">${E(phaseName(r.from_phase))} → <b>${E(phaseName(r.to_phase))}</b> · solicitó ${E(r.requester_name||'')}</p>`:''}<form data-form="reject-request" data-id="${+id}"><div class="field-group"><label class="field-label">Motivo del rechazo *</label><textarea name="review_note" class="field textarea" required minlength="5" maxlength="500" placeholder="Explica qué falta o por qué no procede el avance…"></textarea><div class="source-footnote mt12">Obligatorio. Quedará registrado en la bitácora del predio y lo verá el broker.</div></div><div class="spaced mt20" style="justify-content:flex-end"><button type="button" class="btn btn-ghost" data-action="close-modal">CANCELAR</button><button type="submit" class="btn btn-danger">RECHAZAR CAMBIO DE FASE</button></div></form></div>`;
 document.querySelector('#modal textarea[name="review_note"]')?.focus();
}
function showCreate(opts={}){
 if(!opts.keepPin)state.pin=null;
 const suggested=state.selectedCorridor||1;
 document.getElementById('modal').innerHTML=`<div class="modal-box create-predio-modal"><div class="modal-top"><div><small>ALTA DE PROSPECTO</small><h2>Registrar nuevo predio</h2></div><button class="icon-btn" type="button" data-action="close-modal" aria-label="Cerrar">×</button></div><p class="subhead">Asigna un nombre, corredor y una ubicación real en el mapa. El ID del predio se generará automáticamente al guardar.</p><form data-form="create-predio"><div class="form-grid"><div class="field-group span2"><label class="field-label">Alias o referencia del predio *</label><input class="field" name="alias" placeholder="Ej. predio esquina, costado norte, lote comercial…" required minlength="3" autofocus /></div><div class="field-group"><label class="field-label">Corredor principal *</label><select name="corridor_id" class="field" required>${selectCorridors(suggested).replace('<option value="0"','<option disabled value="0"')}</select></div><div class="field-group"><label class="field-label">Broker responsable</label>${state.user.role==='broker'?`<input class="field" value="${E(state.user.display_name)}" readonly /><input type="hidden" name="broker_id" value="${state.user.id}" />`:`<select name="broker_id" class="field"><option value="">Asignar después</option>${brokers().filter(u=>u.active).map(u=>`<option value="${u.id}">${E(u.display_name)}</option>`).join('')}</select>`}</div><input type="hidden" name="lat" value="${state.pin?state.pin.lat.toFixed(7):''}"/><input type="hidden" name="lng" value="${state.pin?state.pin.lng.toFixed(7):''}"/></div><div class="field-label location-callout-label">Ubicación del predio *</div><button type="button" class="location-callout ${state.pin?'ready':''}" data-action="pick-location" data-origin="create"><span class="location-callout-icon">${icon('pin')}</span><span><strong>${state.pin?'Ubicación marcada en el mapa':'Marcar ubicación en el mapa'}</strong><small id="location-selection-note">${state.pin?`${state.pin.lat.toFixed(7)}, ${state.pin.lng.toFixed(7)} · Toca para ajustar el pin.`:'Toca aquí, ubica el predio en el mapa y confirma el pin.'}</small></span><span class="location-callout-arrow">↗</span></button><div class="spaced mt20" style="justify-content:flex-end"><button type="button" class="btn btn-ghost" data-action="close-modal">CANCELAR</button><button class="btn btn-primary" type="submit">CREAR EXPEDIENTE →</button></div></form></div>`;
}
// Selector de pin. Mantiene el formulario de alta/edición abierto, incluidos todos sus valores.
function normalizePoint(lat,lng){
 const a=Number(lat),b=Number(lng);
 if(!Number.isFinite(a)||!Number.isFinite(b)||a < -90||a > 90||b < -180||b > 180)return null;
 return {lat:+a.toFixed(7),lng:+b.toFixed(7)};
}
// Centros de vista APROXIMADOS por corredor, no son coordenadas de predios ni de cruces certificados.
// Solo sirven para encuadrar el sector del corredor; el broker selecciona el pin real.
const CORRIDOR_FOCUS={
 1:[25.731,-100.375,13],2:[25.632,-100.290,13],3:[25.668,-100.304,13],4:[25.640,-100.328,13],
 5:[25.711,-100.347,13],6:[25.660,-100.321,13],7:[25.746,-100.307,13],8:[25.724,-100.237,13],
 9:[25.664,-100.204,13],10:[25.654,-100.201,13],11:[25.745,-100.324,12],12:[25.775,-100.391,13],
 13:[25.692,-100.298,13],14:[25.680,-100.308,13],15:[25.745,-100.310,13]};
function pickerCorridorOptions(q=''){
 const out=document.getElementById('picker-corridor-results');if(!out)return;
 const fold=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-MX');
 const filter=fold(q.trim());
 const matches=(state.data?.corridors||[]).filter(c=>!filter||fold(`${c.id} ${c.name} ${c.candidate_node}`).includes(filter)).sort((a,b)=>{const rank=c=>fold(c.name).includes(filter)?0:1;return rank(a)-rank(b)});
 out.innerHTML=matches.length?matches.map(c=>`<button type="button" data-action="picker-corridor" data-id="${c.id}"><span class="picker-corridor-number">${String(c.id).padStart(2,'0')}</span><span><strong>${E(c.name)}</strong><small>${E(c.candidate_node)}</small></span><span class="picker-corridor-go">ENFOCAR ›</span></button>`).join(''):'<span class="picker-result-empty">No se encontró el corredor. Prueba otra avenida.</span>';
 out.classList.remove('hidden');
}
function pickerFocusCorridor(id,{updateForm=true}={}){
 const pk=state.picker,c=corridor(id),view=CORRIDOR_FOCUS[id];if(!pk||!c||!view)return;
 pk.corridorId=+id;
 const input=document.getElementById('picker-corridor-query');if(input)input.value=`${String(id).padStart(2,'0')} · ${c.name}`;
 const results=document.getElementById('picker-corridor-results');if(results){results.innerHTML='';results.classList.add('hidden')}
 const badge=document.getElementById('picker-corridor-current');if(badge){badge.innerHTML=`<b>${E(c.name)}</b><span>Intersección guía: ${E(c.candidate_node)} · enfoque orientativo (no predio)</span>`;badge.classList.add('selected')}
 if(updateForm){const form=document.querySelector(pk.origin==='edit'?'form[data-form="save-predio"]':'form[data-form="create-predio"]');const select=form?.querySelector('select[name="corridor_id"]');if(select)select.value=String(id)}
 if(pk.point)pickerValidatePoint(pk.point);
 highlightPickerCorridor(+id);
 if(pk.googleMap){pk.googleMap.panTo({lat:view[0],lng:view[1]});pk.googleMap.setZoom(view[2])}
 else if(pk.map)pk.map.flyTo([view[0],view[1]],view[2]);
}
function pickerCoords(point){
 const t=document.getElementById('picker-coordinates'),btn=document.getElementById('picker-confirm');
 if(t)t.innerHTML=point?`<span class="picker-status-dot"></span><strong>PIN SELECCIONADO</strong><span>${point.lat.toFixed(7)}, ${point.lng.toFixed(7)}</span>`:'<span class="picker-status-dot empty-dot"></span><strong>Ubicación pendiente</strong><span>Haz clic en el mapa para marcar el predio</span>';
 if(btn)btn.disabled=!point||!['validated','unavailable'].includes(state.picker?.validation?.status);
 updatePickerVerificationUI();
 const link=document.getElementById('picker-google-link');if(link){link.classList.toggle('hidden',!point);if(point)link.href=googlePinUrl(point.lat,point.lng);else link.removeAttribute('href')}
 const a=document.getElementById('picker-manual-lat'),b=document.getElementById('picker-manual-lng');
 if(point&&a&&b){a.value=point.lat;b.value=point.lng}
}
let pickerCheckTimer=null;
function updatePickerVerificationUI(){
 const pk=state.picker,btn=document.getElementById('picker-confirm'),alert=document.getElementById('picker-corridor-alert');if(!pk)return;
 const bad=pk.point&&pk.validation?.status==='outside';
 if(btn){btn.disabled=!pk.point||bad;btn.textContent='✓ USAR ESTA UBICACIÓN'}
 if(alert){alert.hidden=!bad;alert.textContent=bad?'⚠ '+pk.validation.message:''}
}
async function pickerValidatePoint(point){
 const pk=state.picker;if(!pk||!point)return;
 pk.validation=corridorLineCheck(pk.corridorId,point,pk.routeData?.lines);updatePickerVerificationUI();
}
function pickerSetPin(point,{fly=false}={}){
 const pk=state.picker;if(!pk||!point)return;
 pk.point=point;pk.validation=null;pickerValidatePoint(point);
 if(pk.googleMap){
  const gm=window.google?.maps;
  if(pk.googleMarker)pk.googleMarker.setPosition(point);
  else if(gm){
   pk.googleMarker=new gm.Marker({map:pk.googleMap,position:point,draggable:true,title:'Arrastra para ajustar el predio'});
   pk.googleMarker.addListener('dragend',e=>pickerSetPin(normalizePoint(e.latLng.lat(),e.latLng.lng())));
  }
  if(fly){pk.googleMap.panTo(point);pk.googleMap.setZoom(17)}
 }else if(pk.map){
  pk.map.setPin(point,false);
  if(fly)pk.map.flyTo([point.lat,point.lng],17);
 }
 pickerCoords(point);
}
function pickerBase(mode){
 const pk=state.picker;if(!pk)return;
 pk.base='streets';
 if(pk.googleMap&&window.google?.maps)pk.googleMap.setMapTypeId('roadmap');
 else if(pk.map)pk.map.setMode('streets');
 document.querySelectorAll('[data-action="picker-base"]').forEach(b=>b.classList.toggle('active',b.dataset.value===mode));
}
function closeLocationPicker(){
 const pk=state.picker;
 if(pk?.map)try{pk.map.remove()}catch(e){}
 if(pk?.googleMarker)try{pk.googleMarker.setMap(null)}catch(e){}
 if(pk?.googleRouteLines)for(const line of pk.googleRouteLines)try{line.setMap(null)}catch(e){}
 if(pk?.googleMap)try{window.google?.maps?.event?.clearInstanceListeners(pk.googleMap)}catch(e){}
 state.picker=null;clearTimeout(pickerCheckTimer);
 const el=document.getElementById('location-picker');if(el)el.innerHTML='';
}
function googleMapsJSKey(){
 let key='';try{key=localStorage.getItem('veo_google_maps_js_key')||''}catch(e){}
 return state.data?.maps_js_key||window.VEO_GOOGLE_MAPS_JS_KEY||key||'';
}
let googleMapLoader=null;
function loadGoogleMapsJS(key){
 if(window.google?.maps?.Map)return Promise.resolve(window.google.maps);
 if(googleMapLoader)return googleMapLoader;
 googleMapLoader=new Promise((resolve,reject)=>{
  const callback='__veoMapsReady';let settled=false;
  const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timeout);if(error){googleMapLoader=null;reject(error)}else resolve(window.google.maps)};
  window[callback]=()=>finish();
  const script=document.createElement('script');script.async=true;script.defer=true;
  script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&loading=async&v=weekly&callback='+callback+'&language=es&region=MX';
  script.onerror=()=>finish(new Error('No se pudo cargar Google Maps. Comprueba la clave, facturación y los dominios autorizados.'));
  const timeout=setTimeout(()=>finish(new Error('Google Maps no respondió.')),20000);
  document.head.appendChild(script);
 });
 return googleMapLoader;
}
function openNativePicker(pk){
 if(state.picker!==pk)return;
 const el=document.getElementById('picker-map');if(!el)return;
 el.innerHTML='';
 const center=pk.point?[pk.point.lat,pk.point.lng]:[25.6866,-100.3161];
 pk.map=new window.VEOMapNative(el,{
  center,zoom:pk.point?17:12,mode:pk.base,
  onPoint:p=>pickerSetPin(normalizePoint(p.lat,p.lng))
 });
 if(pk.point)pickerSetPin(pk.point);
 if(pk.routeData?.lines?.length)pk.map.setRoute(pk.routeData.lines,{color:ROUTE_HIGHLIGHT_COLOR});
 const info=document.getElementById('picker-provider-note');if(info)info.textContent='Mapa de calles Esri · navegación interactiva, búsqueda y captura precisa del pin GPS.';
}
function pickerExistingPins(pk,gm){
 const editingId=pk.origin==='edit'?state.drawer?.predio?.id:null;
 pk.existingMarkers=(state.data?.predios||[]).filter(p=>p.id!==editingId&&p.lat!=null&&p.lng!=null&&Number.isFinite(+p.lat)&&Number.isFinite(+p.lng)).map(p=>new gm.Marker({
  map:pk.googleMap,position:{lat:+p.lat,lng:+p.lng},title:`${p.code} · ${p.alias}`,clickable:false,zIndex:1,
  icon:{path:gm.SymbolPath.CIRCLE,scale:7,fillColor:phaseColor(p.phase),fillOpacity:.95,strokeColor:'#ffffff',strokeWeight:2,labelOrigin:new gm.Point(0,-3.2)},
  label:{text:String(p.alias||'').slice(0,22),className:'veo-gmap-label veo-picker-label',color:'#ffffff',fontSize:'11px',fontWeight:'700'}
 }));
}
async function openGooglePicker(pk,key){
 const info=document.getElementById('picker-provider-note');if(info)info.textContent='Conectando con Google Maps…';
 try{
  const gm=await loadGoogleMapsJS(key);
  if(state.picker!==pk||pk.forceNative)return;
  if(pk.map){pk.map.remove();pk.map=null}
  const el=document.getElementById('picker-map');el.innerHTML='';
  pk.googleMap=new gm.Map(el,{center:pk.point||{lat:25.6866,lng:-100.3161},zoom:pk.point?17:12,mapTypeId:'roadmap',streetViewControl:false,mapTypeControl:false,fullscreenControl:false,clickableIcons:false,gestureHandling:'greedy'});
  pk.googleMap.addListener('click',event=>pickerSetPin(normalizePoint(event.latLng.lat(),event.latLng.lng())));
  pickerExistingPins(pk,gm);
  if(pk.point)pickerSetPin(pk.point);
  if(pk.routeData?.lines?.length)setGoogleCorridorRoute(pk,pk.routeData);
  if(pk.corridorId)highlightPickerCorridor(pk.corridorId);
  if(!pk.point&&pk.corridorId)pickerFocusCorridor(pk.corridorId,{updateForm:false});
  if(info)info.textContent='Calles de Google Maps · selecciona el predio y confirma las coordenadas GPS.';
 }catch(e){
  if(state.picker!==pk)return;
  console.warn('Google Maps no disponible: se usa mapa alternativo.',e);
  openNativePicker(pk);
  if(info)info.textContent='Google Maps no está disponible con esta clave. Se activó el mapa alternativo Esri para continuar.';
  toast('Google Maps requiere clave válida, facturación y dominio autorizado; se habilitó el mapa alternativo.',true);
 }
}
function openLocationPicker(origin='create'){
 if(origin==='edit'&&!state.drawer?.can_edit){toast('No tienes permiso para modificar las coordenadas de este predio.',true);return}
 closeLocationPicker();
 const form=document.querySelector(origin==='edit'?'form[data-form="save-predio"]':'form[data-form="create-predio"]');
 if(!form){toast('Abre primero el formulario de predio.',true);return}
 const lat=form.querySelector('[name="lat"]')?.value,lng=form.querySelector('[name="lng"]')?.value;
 const existing=lat&&lng?normalizePoint(lat,lng):null;
 const selectedId=Number(form.querySelector('select[name="corridor_id"]')?.value||0);
 const pk={origin,point:existing,map:null,googleMap:null,googleMarker:null,base:'streets',forceNative:false,corridorId:selectedId,validation:null,validationToken:0};
 state.picker=pk;
 const key=googleMapsJSKey();
 const target=document.getElementById('location-picker');
 target.innerHTML=`<div class="location-picker-backdrop" data-action="picker-cancel"></div><section class="location-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="picker-title">
 <header class="picker-header"><div><small>GEOREFERENCIACIÓN DEL PREDIO</small><h2 id="picker-title">Selecciona el punto exacto</h2><p>Haz clic en el mapa para colocar el pin. Puedes arrastrarlo hasta la posición correcta.</p></div><button type="button" class="icon-btn" data-action="picker-cancel" aria-label="Cerrar mapa">×</button></header>
 <div class="picker-search-bar"><div class="picker-search-corridor"><label for="picker-corridor-query">01 · ELEGIR CORREDOR METROPOLITANO</label><div class="picker-combobox"><input id="picker-corridor-query" class="field" type="search" placeholder="Buscar entre los 15 corredores…" autocomplete="off" aria-label="Buscar corredor para centrar el mapa" aria-controls="picker-corridor-results"/><button type="button" class="picker-chevron" data-action="picker-corridor-list" aria-label="Ver los 15 corredores">⌄</button></div><div id="picker-corridor-results" class="picker-corridor-results hidden"></div></div><div class="picker-street-search"><label for="picker-search-text">02 · DIRECCIÓN O CRUCE (OPCIONAL)</label><div class="picker-street-row"><input id="picker-search-text" class="field" type="search" placeholder="Buscar avenida, cruce o dirección…" aria-label="Buscar dirección o cruce"/><button type="button" class="btn btn-ghost" data-action="picker-search">⌕ BUSCAR</button></div></div></div>
 <div class="picker-map-toolbar"><div id="picker-corridor-current" class="picker-corridor-current">Selecciona un corredor para enfocar su sector; después marca el predio en el mapa.</div><span class="streets-only-chip">▣ CALLES</span></div>
 <div class="picker-source-tip"><span id="picker-provider-note">${key?'Conectando con Google Maps…':'Mapa de calles Esri (respaldo CARTO) · desplazamiento, zoom e inercia.'}</span></div>
 <div id="picker-results" class="picker-results" aria-live="polite"></div><div class="veo-route-guide"><span class="veo-route-swatch"></span><span>La avenida seleccionada se marca en <b>rosa</b>, usando su trazado cartográfico real.</span><span id="picker-route-status" class="veo-route-status">Selecciona un corredor para ver el trazado.</span><button type="button" data-action="retry-corridor-shape" class="veo-route-retry">↻ Reintentar trazo</button></div><div class="picker-map-wrap"><div id="picker-map" class="picker-map" role="application" aria-label="Mapa para marcar predio"></div><div class="picker-map-hint">⌖ Clic para fijar el pin · Arrastra para ajustar</div><div class="veo-north-indicator" role="img" aria-label="Orientación: norte hacia arriba" title="Norte · mapa orientado hacia arriba"><span>N</span><svg viewBox="0 0 32 44" aria-hidden="true"><path d="M16 3 L27 31 L16 25 L5 31 Z" fill="#fb4979" stroke="#f5fbff" stroke-width="1.5"/><path d="M16 3 V39" stroke="#f5fbff" stroke-width="1.5" opacity=".7"/></svg></div></div>
 <div id="picker-corridor-alert" class="picker-corridor-alert" role="alert" hidden></div><div class="picker-footer"><div class="picker-coordinate-panel"><div id="picker-coordinates" class="picker-coordinates" aria-live="polite"></div><details class="picker-manual"><summary>Capturar coordenadas GPS manualmente</summary><div class="picker-manual-row"><input class="field" id="picker-manual-lat" type="number" min="-90" max="90" step="any" placeholder="Latitud" aria-label="Latitud manual"/><input class="field" id="picker-manual-lng" type="number" min="-180" max="180" step="any" placeholder="Longitud" aria-label="Longitud manual"/><button type="button" class="btn btn-ghost small" data-action="picker-manual">APLICAR GPS</button></div></details></div><div class="picker-footer-actions"><a id="picker-google-link" class="btn btn-ghost picker-google-link hidden" target="_blank" rel="noopener noreferrer" title="Abrir el pin seleccionado en Google Maps">VER EN GOOGLE MAPS ↗</a><button type="button" class="btn btn-ghost" data-action="picker-cancel">CANCELAR</button><button type="button" class="btn btn-primary" id="picker-confirm" data-action="picker-confirm" disabled>✓ USAR ESTA UBICACIÓN</button></div></div>
 </section>`;
 pickerCoords(existing);
 if(existing)pickerValidatePoint(existing);
 // Motor local inicializado incluso si Google falla; el corredor solo fija la vista, nunca el pin.
 openNativePicker(pk);
 if(selectedId&&!existing)pickerFocusCorridor(selectedId,{updateForm:false});
 else if(selectedId){const c=corridor(selectedId),v=document.getElementById('picker-corridor-query');if(v&&c)v.value=`${String(selectedId).padStart(2,'0')} · ${c.name}`;const b=document.getElementById('picker-corridor-current');if(b&&c)b.innerHTML=`<b>${E(c.name)}</b><span>Intersección guía: ${E(c.candidate_node)} · referencia orientativa</span>`}
 if(selectedId&&existing)highlightPickerCorridor(selectedId);
 if(key)openGooglePicker(pk,key);
}
async function pickerSearch(){
 const inp=document.getElementById('picker-search-text'),out=document.getElementById('picker-results');
 if(!inp||!out)return;
 let q=inp.value.trim();if(q.length<3){out.innerHTML='<span>Escribe al menos tres caracteres para buscar.</span>';return}
 out.innerHTML='<span>Buscando referencia geográfica…</span>';
 try{
  const res=await fetch('https://nominatim.openstreetmap.org/search?format=json&countrycodes=mx&limit=5&q='+encodeURIComponent(q+', Nuevo León, México'));
  if(!res.ok)throw Error('No fue posible consultar el geocodificador.');
  const items=await res.json();
  out.innerHTML=items.length?items.map(x=>`<button type="button" data-action="picker-result" data-lat="${E(x.lat)}" data-lng="${E(x.lon)}"><span>⌖</span>${E(x.display_name)}</button>`).join(''):'<span>No se encontró el lugar. Intenta con otra referencia o navega manualmente.</span>';
 }catch(e){out.innerHTML='<span>No hubo resultados de búsqueda. Puedes navegar y marcar el pin directamente en el mapa.</span>'}
}
function confirmLocationPicker(){
 const pk=state.picker;if(!pk?.point){toast('Selecciona primero un pin en el mapa.',true);return}
 if(pk.validation?.status==='outside'){toast(pk.validation.message,true);updatePickerVerificationUI();return}
  const form=document.querySelector(pk.origin==='edit'?'form[data-form="save-predio"]':'form[data-form="create-predio"]');
 if(!form)return;
 const lat=form.querySelector('[name="lat"]'),lng=form.querySelector('[name="lng"]');
 lat.value=pk.point.lat.toFixed(7);lng.value=pk.point.lng.toFixed(7);
 if(pk.origin==='create'){
  state.pin={...pk.point};
  const note=document.getElementById('location-selection-note'),callout=document.querySelector('.location-callout');
  if(note)note.textContent=`${lat.value}, ${lng.value} · Toca para ajustar el pin.`;
  if(callout){callout.classList.add('ready');callout.querySelector('strong').textContent='Ubicación marcada en el mapa'}
 } else {
  toast('Pin aplicado al expediente. Pulsa GUARDAR CAMBIOS para guardar la ubicación.');
 }
 closeLocationPicker();
}
function showUserForm(id){
 if(!isAdmin()){toast('Se requiere rol de administrador',true);return}
 const u=id?users().find(x=>x.id===id):null;if(id&&!u){toast('Usuario no encontrado',true);return}
 const isSelf=u?.id===state.user.id;
 document.getElementById('modal').innerHTML=`<div class="modal-box"><div class="modal-top"><div><small>GESTIÓN DE CREDENCIALES</small><h2>${u?'Administrar cuenta':'Crear usuario con contraseña temporal'}</h2></div><button class="icon-btn" data-action="close-modal">×</button></div><form data-form="${u?'edit-user':'create-user'}" data-id="${u?.id||''}"><div class="form-grid"><div class="field-group"><label class="field-label">Nombre completo *</label><input class="field" name="display_name" required value="${E(u?.display_name||'')}" /></div><div class="field-group"><label class="field-label">Nombre de usuario *</label><input class="field" name="username" ${u?'disabled':''} required placeholder="broker.apellido" value="${E(u?.username||'')}" /></div><div class="field-group"><label class="field-label">Rol del usuario</label><select class="field" name="role">${['broker','supervisor','legal','tecnico','admin'].map(r=>`<option value="${r}" ${u?.role===r?'selected':''}>${r.toUpperCase()}</option>`).join('')}</select></div><div class="field-group"><label class="field-label">${u?'Restablecer contraseña temporal (opcional)':'Contraseña temporal *'}</label><input class="field" type="password" minlength="7" name="password" ${u?'':'required'} ${isSelf?'disabled':''} autocomplete="new-password" placeholder="Mínimo 7 caracteres" /><label class="auth-show-password"><input type="checkbox" data-toggle-password aria-label="Mostrar contraseñas" /><span>Mostrar contraseñas</span></label>${u?`<div class="field-group span2"><label class="field-label">Estado de cuenta</label><select class="field" name="active"><option value="1" ${u.active?'selected':''}>Activa</option><option value="0" ${!u.active?'selected':''}>Dada de baja / sin acceso</option></select></div>`:''}</div><div class="alert-box mt20"><span>🔐</span><div>${isSelf?'Para cambiar tu propia contraseña selecciona Mi contraseña e ingresa la actual.':`La contraseña se entrega al usuario por un canal privado. ${u?'Si la restableces, se cerrarán sus sesiones y tendrá que cambiarla al ingresar.':'En su primer inicio de sesión deberá elegir una nueva.'}`} <b>El administrador sólo ve la fecha de cambio, nunca la contraseña privada.</b></div></div><div class="spaced mt20" style="justify-content:flex-end"><button type="button" class="btn btn-ghost" data-action="close-modal">CANCELAR</button><button class="btn btn-primary" type="submit">GUARDAR CUENTA</button></div></form></div>`;
}
async function openPredio(pid,tab='general'){try{const detail=await api('/api/predios/'+pid);state.drawer=detail;state.drawerTab=tab;drawDetail()}catch(e){toast(e.message,true)}}
function closeDrawer(){state.drawer=null;state.drawerTab='general';document.getElementById('drawer').innerHTML=''}
function showPermanentDeleteDialog(p){
 if(!isAdmin()){toast('Sólo el administrador puede eliminar expedientes.',true);return}
 if(!p){toast('No se encontró el expediente para eliminar.',true);return}
 const modal=document.getElementById('modal');
 modal.innerHTML=`<div class="modal-box destructive-confirm" role="dialog" aria-modal="true" aria-labelledby="delete-title"><div class="modal-top"><div><small>ACCIÓN EXCLUSIVA DEL ADMINISTRADOR</small><h2 id="delete-title">Eliminar predio definitivamente</h2></div><button class="icon-btn" type="button" data-action="close-modal" aria-label="Cerrar">×</button></div><div class="alert-box warn"><span>⚠</span><div><strong>Esta acción es irreversible.</strong> Se eliminarán el pin del mapa, la ubicación, el expediente, todas las fotografías, videos y documentos adjuntos, comentarios, solicitudes de avance y movimientos asociados. No es lo mismo que archivar.</div></div><div class="delete-summary"><div><small>ID DEL PREDIO</small><strong>${E(p.code)}</strong></div><div><small>UBICACIÓN</small><strong>${E(p.alias)}</strong></div><div><small>CORREDOR</small><strong>${E(cname(p.corridor_id))}</strong></div></div><form data-form="delete-predio" data-id="${p.id}"><div class="field-group"><label class="field-label" for="delete-confirm-code">Escribe <b>${E(p.code)}</b> para confirmar</label><input id="delete-confirm-code" class="field" name="confirmation_code" placeholder="ID exacto del predio" autocomplete="off" spellcheck="false" required /></div><label class="delete-ack"><input type="checkbox" name="acknowledge" required /><span>Comprendo que no podré recuperar este expediente desde el CRM.</span></label><div class="spaced mt20" style="justify-content:flex-end"><button class="btn btn-ghost" type="button" data-action="close-modal">CANCELAR</button><button class="btn btn-danger" type="submit">ELIMINAR DEFINITIVAMENTE</button></div></form></div>`;
 modal.querySelector('#delete-confirm-code')?.focus();
}
function drawerTabs(){return ['general','score','docs','check','comments'].map((tab,i)=>`<button data-action="drawer-tab" data-tab="${tab}" class="${state.drawerTab===tab?'active':''}">${['Ficha del predio','Calificación','Documentos','Hitos / Cierre','Bitácora'][i]}</button>`).join('')}
function drawDetail(){const d=state.drawer;if(!d)return;const p=d.predio;document.getElementById('drawer').innerHTML=`<div class="drawer-box"><div class="drawer-top"><div><small>${E(p.code)} · ${E(cname(p.corridor_id))}</small><h2>${E(p.alias)}</h2><div class="spaced mt12">${chipPhase(p)} <span class="chip">${p.score??"—"}/100 SCORE</span> ${d.readiness.complete?'<span class="chip green">● APTO PARA OPERAR</span>':''}</div>${isAdmin()?`<button type="button" class="btn btn-danger small mt12" data-action="prompt-delete-predio" data-id="${p.id}">✕ ELIMINAR EXPEDIENTE Y PIN</button>`:''}</div><button class="icon-btn" data-action="close-drawer">×</button></div><div class="phase-stepper">${PHASES.map((stage,i)=>`<div class="phase-step ${i<stageIndex(p.phase)?'passed':i===stageIndex(p.phase)?'current':''}">${['FACTIBILIDAD','CONTACTO','SEGUIMIENTO','CIERRE','OPERACIÓN'][i]}</div>`).join('')}</div>${lockBanner(d)}<div class="tabs">${drawerTabs()}</div><div id="drawer-content">${drawerContent()}</div></div>`;applyPredioLock(d)}
// ── Predio EN OPERACIÓN: sólo lectura salvo desbloqueo con credenciales del administrador ──
state.unlocks=state.unlocks||{};
function unlockFor(pid){const u=pid&&state.unlocks[pid];if(u&&Date.parse(u.expires_at)>Date.now())return u;if(u)delete state.unlocks[pid];return null}
const predioReadOnly=d=>!!(d?.locked&&!unlockFor(d.predio?.id));
function lockBanner(d){
 if(!d.locked)return '';
 const u=unlockFor(d.predio.id);
 if(u)return `<div class="lock-banner is-open"><span class="lock-ico">🔓</span><div><strong>Edición desbloqueada</strong><small>Predio en operación · editable hasta las ${new Date(u.expires_at).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}</small></div><button type="button" class="btn btn-ghost small" data-action="relock-predio">BLOQUEAR</button></div>`;
 return `<div class="lock-banner"><span class="lock-ico">🔒</span><div><strong>Predio en operación · sólo lectura</strong><small>Para editar se requieren las credenciales del administrador.</small></div><button type="button" class="btn btn-primary small" data-action="unlock-predio">DESBLOQUEAR</button></div>`;
}
function applyPredioLock(d){
 const box=document.querySelector('#drawer .drawer-box');if(!box)return;
 const ro=predioReadOnly(d);box.classList.toggle('is-locked',ro);if(!ro)return;
 const keep=new Set(['close-drawer','drawer-tab','unlock-predio','preview-doc','focus-property']);
 box.querySelectorAll('#drawer-content input,#drawer-content select,#drawer-content textarea').forEach(el=>{el.disabled=true});
 box.querySelectorAll('button').forEach(b=>{if(!keep.has(b.dataset.action))b.disabled=true});
}
function showUnlockDialog(){
 const p=state.drawer?.predio;if(!p)return;
 document.getElementById('modal').innerHTML=`<div class="modal-box unlock-modal"><div class="modal-top"><div><small>PREDIO EN OPERACIÓN · ${E(p.code)}</small><h2>Desbloquear edición</h2></div><button class="icon-btn" type="button" data-action="close-modal" aria-label="Cerrar">×</button></div><p class="subhead">Ingresa el usuario y la contraseña del <b>administrador</b>. La edición quedará habilitada 15 minutos y el desbloqueo se registra en la bitácora.</p><form data-form="unlock-predio"><div class="field-group"><label class="field-label" for="unlock-user">Usuario administrador</label><input id="unlock-user" class="field" name="username" autocomplete="off" autocapitalize="none" required value="${isAdmin()?E(state.user.username):''}"/></div><div class="field-group"><label class="field-label" for="unlock-pass">Contraseña del administrador</label><input id="unlock-pass" class="field" name="password" type="password" autocomplete="off" required/></div><div class="spaced mt20" style="justify-content:flex-end"><button type="button" class="btn btn-ghost" data-action="close-modal">CANCELAR</button><button class="btn btn-primary" type="submit">DESBLOQUEAR →</button></div></form></div>`;
 document.getElementById(isAdmin()?'unlock-pass':'unlock-user')?.focus();
}
function drawerContent(){const d=state.drawer,p=d.predio;return state.drawerTab==='general'?viewGeneral(p):state.drawerTab==='score'?viewScore(p):state.drawerTab==='docs'?viewDocs(d):state.drawerTab==='check'?viewCheck(d):viewComments(d)}
function brokerSelect(id,disabled=false){return `<select name="broker_id" class="field" ${disabled?'disabled':''}><option value="">Sin asignar</option>${brokers().filter(u=>u.active||u.id===id).map(u=>`<option value="${u.id}" ${u.id==id?'selected':''}>${E(u.display_name)}</option>`).join('')}</select>`}
const F=(label,name,val='',other='')=>`<div class="field-group"><label class="field-label">${label}</label><input class="field" name="${name}" value="${E(val)}" ${other}/></div>`;
function viewGeneral(p){let can=state.drawer.can_edit;return `<form data-form="save-predio"><div class="drawer-section"><h3 class="section-title">Identificación y emplazamiento</h3><div class="form-grid">${F('Identificador único', 'code',p.code,'readonly')}${F('Alias / ubicación interna','alias',p.alias,'required')}${F('Municipio','municipio',p.municipio,'placeholder="Ej. Monterrey, Guadalupe..."')}<div class="field-group"><label class="field-label">Corredor VEO</label><select name="corridor_id" class="field">${selectCorridors(p.corridor_id)}</select></div><div class="field-group span2">${F('Dirección o referencia catastral','direccion',p.direccion)}</div><div class="field-group span2">${F('Intersección / referencia de ubicación','referencia',p.referencia)}${F('URL del video con dron (opcional)','dron_url',p.dron_url,'placeholder="https://..."')}</div>${locationEntryFields('edit',p.lat,p.lng)}<div class="field-group span2"><label class="field-label">Broker responsable</label>${brokerSelect(p.broker_id,!isManager())}</div></div>${p.lat!=null&&p.lng!=null?`<div class="spaced mt12"><button type="button" class="btn btn-ghost small" data-action="pick-location" data-origin="edit">⌖ AJUSTAR PIN</button><button type="button" class="btn btn-ghost small" data-action="focus-property" data-id="${p.id}">CENTRAR EN MAPA VEO</button>${googlePinLink(p.lat,p.lng)}</div>`:''}</div>
<div class="drawer-section"><h3 class="section-title">Primer contacto y negociación</h3><div class="form-grid">${F('Propietario / administrador','propietario',p.propietario)}${F('Teléfono','telefono',p.telefono)}${F('Correo electrónico','email',p.email,'type="email"')}${F('Fecha primer contacto','fecha_contacto',p.fecha_contacto,'type="date"')}<div class="field-group"><label class="field-label">Respuesta / interés</label><select class="field" name="interes">${[['sin_contacto','Sin contactar'],['evaluando','En evaluación'],['interesado','Interesado'],['rechazado','No interesado']].map(([v,t])=>`<option value="${v}" ${p.interes===v?'selected':''}>${t}</option>`).join('')}</select></div>${F('Fecha de carta intención','fecha_carta',p.fecha_carta,'type="date"')}<div class="field-group span2"><label style="display:flex;gap:10px;font-size:12px;color:#d2e4f2;line-height:1.55;align-items:flex-start"><input name="clausula_condicional" type="checkbox" style="accent-color:#f8407b;width:18px;height:18px;margin-top:2px;flex:none" ${p.clausula_condicional?'checked':''}/> Se explicó que el contrato sólo surtirá efectos para operar cuando se obtenga el permiso municipal aplicable.</label></div><div class="field-group span2"><label class="field-label">Permiso municipal</label><select class="field" name="permiso_status" ${['admin','supervisor','legal'].includes(state.user.role)?'':'disabled'}>${[['no_iniciado','Sin iniciar'],['en_tramite','En trámite'],['autorizado','AUTORIZADO'],['rechazado','Rechazado']].map(([v,t])=>`<option value="${v}" ${p.permiso_status===v?'selected':''}>${t}</option>`).join('')}</select><div class="source-footnote mt12">El estatus "Autorizado" es requisito para operar; adjuntar el documento del permiso es opcional.</div></div><div class="field-group span2"><label class="field-label">Observaciones de factibilidad y negociación</label><textarea name="notas" class="field textarea" placeholder="Comentarios estratégicos, URL de video dron en la nube, obstáculos de visibilidad...">${E(p.notas)}</textarea></div></div></div><div class="spaced" style="justify-content:flex-end">${isManager()?`<button class="btn btn-ghost small" type="button" data-action="archive-predio" data-id="${p.id}">ARCHIVAR PREDIO</button>`:''}${isAdmin()?`<button class="btn btn-danger small" type="button" data-action="prompt-delete-predio" data-id="${p.id}">ELIMINAR DEFINITIVAMENTE</button>`:''}<button class="btn btn-primary" type="submit" ${!can&&state.user.role!=='legal'&&state.user.role!=='tecnico'?'disabled':''}>GUARDAR CAMBIOS</button></div></form>`}
function viewScore(p){let ratings={};try{ratings=JSON.parse(p.ratings_json||'{}')}catch(e){}return `<div class="drawer-section"><div class="split-even"><div><div class="page-kicker">SCORE INTERNO DE FACTIBILIDAD</div><div class="score-giant" id="live-score">${p.score}<small style="font-size:19px;color:#8bacc8"> /100</small></div><div class="score-bar"><div id="live-score-fill" style="width:${p.score}%"></div></div><p class="source-footnote">Evaluación del broker; no reemplaza estudios técnicos, visita a sitio o permisos.</p></div><div class="value-card"><small>Umbral para solicitar avance</small><b>≥70 / 100</b><p class="tiny muted">No cambia la fase automáticamente. Exige evidencia y autorización adicional.</p></div></div></div><form data-form="save-score"><div class="drawer-section"><h3 class="section-title">Matriz ponderada · ${Object.keys(WEIGHTS).length} criterios</h3>${Object.entries(WEIGHTS).map(([k,w])=>`<div class="rating-row"><div><strong>${E(RATINGLABEL[k])}</strong><small>Peso: ${w}% · escala 0 a 5</small></div><input name="${k}" type="range" min="0" max="5" step="1" value="${ratings[k]||0}" data-score-slider="1"/><span class="grade" id="rating-${k}">${ratings[k]||0}/5</span></div>`).join('')}<div class="spaced mt20" style="justify-content:flex-end"><button class="btn btn-primary" type="submit" ${!state.drawer.can_edit?'disabled':''}>GUARDAR EVALUACIÓN</button></div></div></form>`}
function docGeoLine(x,p){
 if(x.geo_lat==null||x.geo_lng==null)return '';
 const src=x.geo_source==='exif'?'GPS de la foto':'Ubicación del dispositivo'+(x.geo_accuracy_m?' (±'+x.geo_accuracy_m+' m)':'');
 let dist='';if(p&&p.lat!=null&&p.lng!=null&&window.VEOGeoFoto){const m=window.VEOGeoFoto.distanceMeters({lat:+p.lat,lng:+p.lng},{lat:+x.geo_lat,lng:+x.geo_lng});dist=' · <span class="'+(m>500?'doc-geo-far':'')+'">a '+(m<1000?Math.round(m)+' m':(m/1000).toFixed(1)+' km')+' del pin</span>'}
 return '<small class="doc-geo">📍 '+(+x.geo_lat).toFixed(6)+', '+(+x.geo_lng).toFixed(6)+' · '+E(src)+dist+'</small>'+googlePinLink(x.geo_lat,x.geo_lng,'GOOGLE MAPS','btn btn-ghost small doc-geo-btn');
}
function viewDocs(d){const docs=d.documents,count={};for(const x of docs)count[x.doc_type]=(count[x.doc_type]||0)+1;const defType=d.predio.phase==='EN_OPERACION'?'operacion':(Object.keys(DOC_TYPES).find(k=>!count[k]&&!['otro','dron','mecanica_suelos','permiso_municipal','operacion'].includes(k))||'foto');return `<div class="drawer-section"><h3 class="section-title">Expediente documental</h3><p class="source-footnote">Adjunta fotografía, captura de mapa, video con dron, carta de intención, recibo del predial, contrato, estudios o fotos y videos del sitio en operación. Los adjuntos se vinculan al ID único del predio.</p><form data-form="upload-doc"><div class="form-grid"><div class="field-group span2"><label class="field-label">Tipo de documento</label><div class="doc-types" role="radiogroup" aria-label="Tipo de documento">${Object.entries(DOC_TYPES).map(([k,v])=>`<label class="doc-type ${count[k]?'done':''}"><input type="radio" name="doc_type" value="${k}" ${k===defType?'checked':''}/><span class="doc-type-name">${E(v)}</span><span class="doc-type-state">${count[k]?`✓ ${count[k]>1?count[k]+' subidos':'Subido'}`:'Pendiente'}</span></label>`).join('')}</div></div><div class="field-group span2"><label class="field-label">Archivo</label><input type="file" name="file" class="field" accept=".pdf,.png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.heic" required/></div></div><div class="spaced mt20" style="justify-content:flex-end"><button class="btn btn-cyan" type="submit">＋ SUBIR AL EXPEDIENTE</button></div></form></div><div class="drawer-section"><h3 class="section-title">Documentos vinculados · ${docs.length}</h3>${docs.length?docs.map(x=>`<div class="docrow"><div class="docicon">${x.doc_type==='foto'||x.doc_type==='satelital'?'▧':x.doc_type==='dron'?'▶':'▤'}</div><div class="meta"><strong>${E(x.original_filename)}</strong><small>${E(DOC_TYPES[x.doc_type]||x.doc_type)} · ${E(x.uploaded_by_name)} · ${day(x.created_at)} · ${(x.size_bytes/1024/1024).toFixed(2)} MB</small>${docGeoLine(x,d.predio)}</div>${demo?`<button class="btn btn-ghost small" data-action="preview-doc" data-id="${x.id}">VER</button>`:`<a class="btn btn-ghost small" href="/api/documents/${x.id}/content" target="_blank" rel="noopener">VER ↗</a>`}<button class="btn btn-danger small" data-action="delete-doc" data-id="${x.id}">×</button></div>`).join(''):listEmpty('Sin adjuntos','Carga la evidencia requerida para calificar esta ubicación.')}</div>`}
function checkList(items){return items.map(x=>`<div class="check-item"><span class="${x.done?'check-yes':'check-no'}">${x.done?'✓':'×'}</span><span>${E(x.label)}</span></div>`).join('')}
function viewCheck(d){const p=d.predio,idx=stageIndex(p.phase),LAST=PHASES.length-1,next=PHASES[idx+1],req=d.next_requirements,pend=d.requests.find(x=>x.status==='pendiente');return `<div class="drawer-section"><h3 class="section-title">${idx===LAST?'En operación · evidencia del sitio':`Paso siguiente: ${phaseName(next)}`}</h3>${idx===LAST?`<div class="alert-box"><span>▶</span><div><b>Predio EN OPERACIÓN.</b> Agrega fotos y videos del sitio funcionando en la pestaña Documentos con la clasificación «Fotos / videos en operación».</div></div>`:idx===3?`<div class="alert-box warn"><span>⚖</span><div><b>Estado actual: CIERRE.</b> No se considera operable sólo por tener contrato. La condición de vigencia contractual exige permiso municipal autorizado, además de la documentación técnico-estructural. Con el expediente completo se puede solicitar el paso a EN OPERACIÓN.</div></div>`:`<p class="source-footnote">Para solicitar autorización, cumple todos los requisitos de este paso. Una persona con rol Supervisor o Administrador debe aprobar el movimiento.</p>`}${idx<LAST?checkList(req):checkList(d.readiness.items)}<div class="spaced mt20">${idx<LAST?`<button class="btn btn-primary" data-action="request-advance" ${!req.every(x=>x.done)||pend?'disabled':''}>${pend?'SOLICITUD PENDIENTE':'SOLICITAR AVANCE DE FASE →'}</button>`:`<span class="chip ${d.readiness.complete?'green':'amber'}">${d.readiness.complete?'✓ APTO PARA OPERAR':'◷ EXPEDIENTE NO APTO PARA OPERAR'}</span>`}</div></div><div class="drawer-section"><h3 class="section-title">Documentos obligatorios para operar</h3>${checkList(d.readiness.items)}<div class="spaced mt20"><button class="btn btn-ghost" data-action="drawer-tab" data-tab="docs">VER / CARGAR DOCUMENTOS →</button></div></div><div class="drawer-section"><h3 class="section-title">Historial de autorizaciones</h3>${d.requests.length?d.requests.map(r=>`<div class="list-log"><div class="log-circle">${r.status==='pendiente'?'◷':'✓'}</div><div><strong>${phaseName(r.from_phase)} → ${phaseName(r.to_phase)}</strong><p>Solicitud: ${day(r.created_at)} · ${E(r.status)} ${r.review_note?' · '+E(r.review_note):''}</p></div></div>`).join(''):listEmpty('Sin solicitudes anteriores','Todavía no hay movimientos de fase.')}</div>`}
function viewComments(d){return `<div class="drawer-section"><h3 class="section-title">Bitácora de negociación y comentarios</h3><form data-form="add-comment"><textarea name="body" class="field textarea" required placeholder="Registrar acuerdos, llamadas, citas, contactos, visitas y siguientes pasos..."></textarea><div class="spaced mt12" style="justify-content:flex-end"><button class="btn btn-cyan" type="submit">PUBLICAR COMENTARIO</button></div></form></div><div class="drawer-section"><h3 class="section-title">Comentarios</h3>${d.comments.length?d.comments.map(x=>`<div class="list-log"><div class="log-circle">✎</div><div><strong>${E(x.author)} · ${day(x.created_at)}</strong><p style="white-space:pre-wrap;color:#c3d7e8">${E(x.body)}</p></div></div>`).join(''):listEmpty('Sin comentarios','Registra aquí el primer contacto y los avances de cada negociación.')}</div><div class="drawer-section"><h3 class="section-title">Auditoría / movimientos</h3>${d.history.map(x=>`<div class="list-log"><div class="log-circle">↗</div><div><strong>${E(x.detail)}</strong><p>${E(x.author)} · ${day(x.created_at)}</p></div></div>`).join('')}</div>`}
async function action(target){const cmd=target.dataset.action,id=+target.dataset.id;
 try{
  if(cmd==='nav'){if(target.dataset.view==='credenciales'&&!isAdmin())throw Error('Sólo el Administrador puede abrir este módulo');if(target.dataset.view==='brokers'&&state.user.role==='broker')throw Error('Módulo disponible sólo para supervisión.');closeCommand();if(target.dataset.mapOverview==='1'){state.selectedCorridor=0;state.phaseFilter='';state.brokerFilter='';state.search='';}state.view=target.dataset.view;render();window.scrollTo({top:0,behavior:'instant'});return}
  if(cmd==='toggle-menu'){toggleMobileMenu();return}
  if(cmd==='open-command'){openCommand();return}
  if(cmd==='close-command'){closeCommand();return}
  if(cmd==='command-predio'){closeCommand();await openPredio(id);return}
  if(cmd==='command-corridor'){closeCommand();state.selectedCorridor=id;state.view='mapa';state.mapProvider='veo';render();window.scrollTo(0,0);return}
  if(cmd==='export-local-backup'){await exportLocalBackup();toast('Respaldo generado. Guárdalo en un lugar privado; incluye datos locales y registros de prueba.');return}
  if(cmd==='logout'){await api('/api/logout',{method:'POST',body:'{}'});closeDrawer();loginScreen();return}
  if(cmd==='new-predio'){showCreate();return}
  if(cmd==='map-new-location'){showCreate();openLocationPicker('create');return}
  if(cmd==='pick-location'){openLocationPicker(target.dataset.origin||'create');return}
  if(cmd==='picker-native'){
   const pk=state.picker;if(!pk)return;
   pk.forceNative=true;
   if(pk.googleMarker)pk.googleMarker.setMap(null);
   pk.googleMarker=null;pk.googleMap=null;
   openNativePicker(pk);return;
  }
  if(cmd==='picker-corridor-list'){document.getElementById('picker-corridor-query')?.focus();pickerCorridorOptions('');return}
  if(cmd==='picker-corridor'){pickerFocusCorridor(id);return}
  if(cmd==='retry-corridor-shape'){if(state.picker?.corridorId)highlightPickerCorridor(state.picker.corridorId);return}
  if(cmd==='picker-cancel'){closeLocationPicker();return}
  if(cmd==='picker-confirm'){confirmLocationPicker();return}
  if(cmd==='picker-manual'){const a=document.getElementById('picker-manual-lat'),b=document.getElementById('picker-manual-lng');if(!a.value.trim()||!b.value.trim()){toast('Introduce latitud y longitud.',true);return}const point=normalizePoint(a.value,b.value);if(!point){toast('Las coordenadas GPS están fuera de rango.',true);return}pickerSetPin(point,{fly:true});return}
  if(cmd==='picker-search'){await pickerSearch();return}
  if(cmd==='picker-result'){const point=normalizePoint(target.dataset.lat,target.dataset.lng);if(state.picker&&point){if(state.picker.googleMap){state.picker.googleMap.panTo(point);state.picker.googleMap.setZoom(17)}else state.picker.map?.flyTo([point.lat,point.lng],17);document.getElementById('picker-results').innerHTML='<span>Referencia centrada. Haz clic en el predio exacto para colocar el pin.</span>';}return}
  if(cmd==='close-modal'){closeLocationPicker();document.getElementById('modal').innerHTML='';state.pin=null;return}
  if(cmd==='close-drawer'){closeDrawer();return}
  if(cmd==='install-app'){if(window.VEOInstall?.canPrompt()){const ok=await window.VEOInstall.prompt();if(ok){toast('VEO quedó instalada en tu pantalla de inicio.');render()}return}showInstallHelp();return}
  if(cmd==='install-hide'){window.VEOInstall?.hide();render();toast('Puedes instalarla después desde «Instalar app» en el inicio.');return}
  if(cmd==='open-predio'){await openPredio(id);return}
  if(cmd==='show-corridor'){state.selectedCorridor=id;state.view='mapa';state.mapProvider='veo';render();window.scrollTo(0,0);return}
  if(cmd==='locate-opportunity'){const p=state.data.predios.find(x=>x.id===id);if(!p||p.lat==null||p.lng==null){toast('Este predio aún no tiene coordenadas.',true);return}if(state.mapProvider!=='veo'){state.mapProvider='veo';render();setTimeout(()=>state.map?.flyTo([+p.lat,+p.lng],17),140)}else state.map?.flyTo([+p.lat,+p.lng],17);if(state.map?.openMarker?.(id))return;await openPredio(id);return}
  if(cmd==='metro-overview'){state.selectedCorridor=0;state.phaseFilter='';state.brokerFilter='';state.search='';state.view='mapa';render();return}
  if(cmd==='clear-filters'){state.search='';state.selectedCorridor=0;state.brokerFilter='';state.phaseFilter='';render();return}
  if(cmd==='aforo-minus'){aforoEscala(aforoZoomActual-25);return} if(cmd==='aforo-plus'){aforoEscala(aforoZoomActual+25);return} if(cmd==='aforo-fit'){aforoEscala(100);return} if(cmd==='aforo-double'){aforoEscala(200);return} if(cmd==='open-sheet'){const c=corridor(id);if(c&&!hasSheet(c))throw Error('Este corredor no tiene ficha de aforo en el estudio.');showSheet(id);return}
  if(cmd==='search-node'){await searchNode(id);return}
  if(cmd==='dash-operating'){state.search='';state.selectedCorridor=0;state.brokerFilter='';state.phaseFilter='EN_OPERACION';state.view='predios';render();window.scrollTo({top:0,behavior:'instant'});return}
  if(cmd==='drawer-tab'){state.drawerTab=target.dataset.tab;drawDetail();return}
  if(cmd==='unlock-predio'){showUnlockDialog();return}
  if(cmd==='relock-predio'){const pid=state.drawer?.predio?.id;if(pid)delete state.unlocks[pid];await openPredio(pid,state.drawerTab);toast('Predio bloqueado de nuevo.');return}
  if(cmd==='focus-property'){let p=state.data.predios.find(x=>x.id===id);if(p){state.mapProvider='veo';state.selectedCorridor=p.corridor_id;state.phaseFilter='';state.brokerFilter='';state.view='mapa';closeDrawer();render();setTimeout(()=>{state.map?.flyTo([+p.lat,+p.lng],16);state.map?.openMarker?.(p.id)},150)}return}
  if(cmd==='my-password'){showOwnPasswordForm();return}
  if(cmd==='deactivate-broker'){
   if(!isAdmin())throw Error('Sólo el Administrador puede dar de baja a un broker');
   const u=users().find(x=>x.id===id);if(!u||u.role!=='broker')throw Error('Broker no encontrado');
   if(!confirm(`¿Dar de baja a ${u.display_name}? Su usuario dejará de ingresar y no aparecerá al asignar nuevos predios. Sus predios y el historial se conservarán.`))return;
   const result=await api('/api/users/'+id,{method:'DELETE',body:'{}'});
   await refresh();toast(`Broker dado de baja. ${result.predios_preservados??0} predio(s) históricos conservados.`);return;
  }
  if(cmd==='reactivate-broker'){
   if(!isAdmin())throw Error('Sólo el Administrador puede reactivar un broker');
   if(!confirm('¿Reactivar este broker? Podrá volver a iniciar sesión con su contraseña actual.'))return;
   await api('/api/users/'+id,{method:'PATCH',body:JSON.stringify({active:true})});await refresh();toast('Broker reactivado.');return;
  }
  if(cmd==='new-user'){showUserForm();return}
  if(cmd==='edit-user'){showUserForm(id);return}
  if(cmd==='request-advance'){if(!state.drawer)return;await api(`/api/predios/${state.drawer.predio.id}/request`,{method:'POST',body:JSON.stringify({reason:'Avance solicitado desde el expediente VEO'})});toast('Solicitud enviada a supervisión. La fase aún no cambia.');await refresh(true);return}
  if(cmd==='resolve'){const status=target.dataset.decision;if(status==='aprobada'&&!confirm('¿Aprobar avance? Se actualizará la fase del predio.'))return;if(status==='rechazada'){showRejectDialog(id);return}await api(`/api/requests/${id}/resolve`,{method:'POST',body:JSON.stringify({decision:status,review_note:''})});toast('Solicitud '+status+'.');await refresh(!!state.drawer);return}
  if(cmd==='view-archives'){const result=await api('/api/archives');document.getElementById('modal').innerHTML=`<div class="modal-box" style="max-width:790px"><div class="modal-top"><div><small>REGISTROS CONSERVADOS</small><h2>Predios archivados</h2></div><button class="icon-btn" data-action="close-modal">×</button></div><p class="subhead">Un predio archivado se oculta del pipeline, pero conserva documentos, trazabilidad y registro histórico.</p><div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>UBICACIÓN</th><th>CORREDOR</th><th>ACCIÓN</th></tr></thead><tbody>${result.predios.map(p=>`<tr><td>${E(p.code)}</td><td>${E(p.alias)}</td><td>${E(cname(p.corridor_id))}</td><td><button class="btn btn-cyan small" data-action="restore-predio" data-id="${p.id}">RESTAURAR</button>${isAdmin()?` <button class="btn btn-danger small" data-action="prompt-delete-predio" data-id="${p.id}">ELIMINAR</button>`:''}</td></tr>`).join('')||'<tr><td colspan="4">No hay predios archivados.</td></tr>'}</tbody></table></div></div>`;return}
  if(cmd==='restore-predio'){if(!confirm('¿Restaurar este predio al pipeline activo?'))return;await api(`/api/predios/${id}/archive`,{method:'POST',body:JSON.stringify({restore:true})});document.getElementById('modal').innerHTML='';await refresh();toast('Predio restaurado.');return}
  if(cmd==='prompt-delete-predio'){
   if(!isAdmin())throw Error('Sólo el administrador puede borrar un predio.');
   let p=state.drawer?.predio?.id===id?state.drawer.predio:state.data.predios.find(x=>x.id===id);
   if(!p){const archives=await api('/api/archives');p=archives.predios.find(x=>x.id===id)}
   if(!p)throw Error('No se encontró el expediente para eliminar.');
   // Cerrar la ficha ANTES de presentar la confirmación para evitar dos capas superpuestas.
   // Se conserva el objeto p recuperado para mostrar el ID y el resumen en el diálogo.
   closeDrawer();
   showPermanentDeleteDialog(p);return;
  }
  if(cmd==='archive-predio'){if(!confirm('¿Archivar el predio? No se eliminarán sus evidencias, comentarios ni historial.'))return;await api(`/api/predios/${id}/archive`,{method:'POST',body:'{}'});closeDrawer();await refresh();toast('Predio archivado; su historial permanece disponible en el servidor.');return}
  if(cmd==='delete-doc'){if(!confirm('¿Eliminar el documento del expediente?'))return;await api(`/api/documents/${id}`,{method:'DELETE'});toast('Documento eliminado.');await refresh(true);return}
  if(cmd==='preview-doc'){let doc=state.drawer?.documents.find(x=>x.id===id);if(doc?.data){const win=window.open();if(win)win.location.href=doc.data;else toast('El navegador bloqueó la ventana emergente; permite ventanas para esta vista previa.',true)}return}
 }catch(err){toast(err.message,true)}
}
// Búsqueda universal rápida; no re-renderiza el CRM al escribir.
function openCommand(){
 const layer=document.getElementById('command-layer');if(!layer)return;
 layer.className='command-layer';layer.innerHTML=`<div class="command-box" role="dialog" aria-modal="true" aria-label="Búsqueda rápida de VEO"><div class="command-input-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><input id="command-query" type="search" placeholder="Buscar un predio, corredor o sección…" autocomplete="off" aria-label="Buscar" /><button class="icon-btn" data-action="close-command" aria-label="Cerrar buscador">×</button></div><div class="command-results" id="command-results"></div><div class="command-footer"><span>Selecciona un resultado para abrirlo</span><span>Esc para cerrar · Ctrl K</span></div></div>`;
 updateCommandResults('');layer.querySelector('#command-query')?.focus();
}
function closeCommand(){const layer=document.getElementById('command-layer');if(layer){layer.className='hidden';layer.innerHTML=''}}
function updateCommandResults(value){
 const container=document.getElementById('command-results');if(!container||!state.data)return;
 const q=String(value||'').trim().toLowerCase();
 const p=state.data.predios.filter(x=>[x.code,x.alias,x.municipio,x.direccion,cname(x.corridor_id)].join(' ').toLowerCase().includes(q)).slice(0,q?7:4);
 const c=state.data.corridors.filter(x=>[x.name,x.candidate_node,x.code].join(' ').toLowerCase().includes(q)).slice(0,q?6:4);
 const sections=NAV.filter(([k,label])=>(k!=='credenciales'||isAdmin())&&(k!=='brokers'||state.user.role!=='broker')&&label.toLowerCase().includes(q)).slice(0,q?4:3);
 const resultItem=(action,id,title,sub,type,character='↗')=>`<button class="command-item" data-action="${action}" ${id!=null?`data-id="${id}"`:''} ${type?`data-view="${type}"`:''}><span class="command-icon">${character}</span><span><strong>${E(title)}</strong><small>${E(sub)}</small></span><span class="command-chevron">↗</span></button>`;
 container.innerHTML=(p.length?`<div class="command-heading">PREDIOS</div>`+p.map(x=>resultItem('command-predio',x.id,`${x.code} · ${x.alias}`,`${cname(x.corridor_id)} · ${phaseName(x.phase)}`,null,'⌖')).join(''):'')+
 (c.length?`<div class="command-heading">CORREDORES</div>`+c.map(x=>resultItem('command-corridor',x.id,x.name,`Intersección: ${x.candidate_node}`,null,'◈')).join(''):'')+
 (sections.length?`<div class="command-heading">SECCIONES</div>`+sections.map(([key,label])=>resultItem('nav',null,label,'Ir a esta sección',key,'⌘')).join(''):'')+
 (!p.length&&!c.length&&!sections.length?`<div class="empty">No hay coincidencias. Prueba otro término.</div>`:'');
}
document.addEventListener('click',ev=>{if(ev.target.id==='sidebar-backdrop'){closeMobileMenu();return}if(ev.target.id==='command-layer'){closeCommand();return}const x=ev.target.closest('[data-action]');if(x){ev.preventDefault();action(x)}});
document.addEventListener('change',ev=>{let el=ev.target;if(el.matches('[data-toggle-password]')){const form=el.closest('form');form?.querySelectorAll('input[autocomplete="current-password"],input[autocomplete="new-password"],input[name="password"],input[name="current_password"],input[name="new_password"],input[name="confirm_password"]').forEach(input=>{input.type=el.checked?'text':'password'});return}if(el.dataset.change==='corridor'){state.selectedCorridor=+el.value;render()}else if(el.dataset.change==='phase'){state.phaseFilter=el.value;render()}else if(el.dataset.change==='broker'){state.brokerFilter=el.value;render()}else if(el.id==='search-predios'){state.search=el.value;updatePredioRows()}});
document.addEventListener('input',ev=>{if(ev.target.id==='command-query'){updateCommandResults(ev.target.value);return}if(ev.target.id==='search-predios'){state.search=ev.target.value;updatePredioRows();return}if(ev.target.dataset.scoreSlider){const inp=ev.target;document.getElementById('rating-'+inp.name).textContent=inp.value+'/5';let s=Math.round([...document.querySelectorAll('[data-score-slider]')].reduce((sum,x)=>sum+Number(x.value)*WEIGHTS[x.name]/5,0));const val=document.getElementById('live-score'),fill=document.getElementById('live-score-fill');if(val)val.innerHTML=`${s}<small style="font-size:19px;color:#8bacc8"> /100</small>`;if(fill)fill.style.width=s+'%'}});
document.addEventListener('keydown',ev=>{if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='k'){ev.preventDefault();document.getElementById('command-layer')?.classList.contains('hidden')?openCommand():closeCommand();return}if(ev.key==='Escape'&&!(document.getElementById('command-layer')?.classList.contains('hidden'))){closeCommand();return}if(ev.key==='Escape'){if(state.picker){const results=document.getElementById('picker-corridor-results');if(results&&!results.classList.contains('hidden')){results.classList.add('hidden');return}closeLocationPicker();return}if(document.getElementById('modal').innerHTML){document.getElementById('modal').innerHTML='';state.pin=null}else if(state.drawer)closeDrawer()}if(ev.key==='Enter'&&ev.target.id==='picker-corridor-query'){ev.preventDefault();const first=document.querySelector('#picker-corridor-results button[data-action="picker-corridor"]');if(first)pickerFocusCorridor(+first.dataset.id);return}if(ev.key==='Enter'&&ev.target.id==='picker-search-text'){ev.preventDefault();pickerSearch();return}if(ev.key==='Enter'&&ev.target.id==='search-predios'){ev.preventDefault();state.search=ev.target.value;updatePredioRows()}});
function fields(form){let d=Object.fromEntries(new FormData(form).entries());return d}
async function forms(form){const cmd=form.dataset.form;let d=fields(form);const save=(url,method,obj)=>api(url,{method,body:JSON.stringify(obj)});
 if(cmd==='login'){await api('/api/login',{method:'POST',body:JSON.stringify(d)});await loadAll();return}
 if(cmd==='change-password'){
  if(d.new_password!==d.confirm_password)throw Error('Las contraseñas nuevas no coinciden');
  await save('/api/me/password','POST',{current_password:d.current_password,new_password:d.new_password});
  document.getElementById('modal').innerHTML='';await loadAll();toast('Tu contraseña se actualizó correctamente.');return;
 }
 if(cmd==='delete-predio'){
  if(!isAdmin())throw Error('Sólo el administrador puede borrar un predio.');
  if(!form.querySelector('[name="acknowledge"]')?.checked)throw Error('Marca la confirmación de eliminación irreversible.');
  const pid=+form.dataset.id;
  const response=await api(`/api/predios/${pid}`,{method:'DELETE',body:JSON.stringify({confirmation_code:d.confirmation_code.trim()})});
  document.getElementById('modal').innerHTML='';closeDrawer();state.pin=null;
  await refresh();
  toast(response.files_cleanup_pending?`Predio ${response.deleted_code} eliminado. Revisa ${response.files_cleanup_pending} archivo(s) pendiente(s) de limpieza en el servidor.`:`Predio ${response.deleted_code} y todos sus registros eliminados. El pin desapareció del mapa.`,!!response.files_cleanup_pending);
  return;
 }
 if(cmd==='unlock-predio'){const pid=state.drawer?.predio?.id;if(!pid)return;const r=await api(`/api/predios/${pid}/unlock`,{method:'POST',body:JSON.stringify({username:d.username,password:d.password})});state.unlocks[pid]={token:r.token,expires_at:r.expires_at};document.getElementById('modal').innerHTML='';await openPredio(pid,state.drawerTab);toast('Edición desbloqueada por 15 minutos.');return}
 if(cmd==='create-predio'){if(!d.lat||!d.lng)throw Error('Toca «Marcar ubicación en el mapa» y confirma el pin para registrar el predio.');if((d.lat&&!d.lng)||(!d.lat&&d.lng))throw Error('Selecciona un pin válido con ambas coordenadas.');const point=d.lat&&d.lng?normalizePoint(d.lat,d.lng):null;if((d.lat||d.lng)&&!point)throw Error('La latitud o longitud no es válida.');await assertCorridorPoint(+d.corridor_id,point);const p=await save('/api/predios','POST',{corridor_id:+d.corridor_id,alias:d.alias,broker_id:d.broker_id?+d.broker_id:null,lat:point?.lat??null,lng:point?.lng??null});state.pin=null;document.getElementById('modal').innerHTML='';await refresh();await openPredio(p.id);toast('Predio '+p.code+' creado correctamente.');return}
 if(cmd==='reject-request'){const note=String(d.review_note||'').trim();if(note.length<5)throw Error('Escribe el motivo del rechazo (mínimo 5 caracteres).');await api(`/api/requests/${+form.dataset.id}/resolve`,{method:'POST',body:JSON.stringify({decision:'rechazada',review_note:note})});document.getElementById('modal').innerHTML='';toast('Cambio de fase rechazado. El motivo quedó en la bitácora.');await refresh(!!state.drawer);return}
 if(cmd==='create-user'){await save('/api/users','POST',d);document.getElementById('modal').innerHTML='';await refresh();toast('Usuario creado con contraseña temporal. Debe cambiarla al ingresar.');return}
 if(cmd==='edit-user'){const patch={display_name:d.display_name,role:d.role,active:d.active==='1'};if(d.password)patch.password=d.password;await save('/api/users/'+form.dataset.id,'PATCH',patch);document.getElementById('modal').innerHTML='';await refresh();toast(d.password?'Contraseña temporal restablecida. El usuario debe cambiarla al ingresar.':'Cuenta actualizada sin afectar predios.');return}
 if(!state.drawer)throw Error('Expediente no seleccionado');const pid=state.drawer.predio.id;
 if(cmd==='save-predio'){const checkPoint=d.lat&&d.lng?normalizePoint(d.lat,d.lng):null;const old=state.drawer?.predio;if(checkPoint&&old&&(String(old.corridor_id)!==String(d.corridor_id)||Math.abs(+old.lat-checkPoint.lat)>0.0000008||Math.abs(+old.lng-checkPoint.lng)>0.0000008)){await assertCorridorPoint(+d.corridor_id,checkPoint)}const body={...d,broker_id:d.broker_id?+d.broker_id:null,corridor_id:+d.corridor_id,lat:d.lat!==''&&d.lat!=null?+d.lat:null,lng:d.lng!==''&&d.lng!=null?+d.lng:null,clausula_condicional:!!form.querySelector('[name="clausula_condicional"]').checked};delete body.code;if(!['admin','supervisor','legal'].includes(state.user.role))delete body.permiso_status;if(state.user.role==='broker')delete body.broker_id;await save(`/api/predios/${pid}`,'PATCH',body);await refresh(true);toast('Datos del predio actualizados.');return}
 if(cmd==='save-score'){const ratings={};for(let k of Object.keys(WEIGHTS))ratings[k]=Number(d[k]||0);await save(`/api/predios/${pid}`,'PATCH',{ratings_json:JSON.stringify(ratings)});await refresh(true);toast('Calificación guardada.');return}
 if(cmd==='add-comment'){if(!d.body?.trim())throw Error('Escriba un comentario');await save(`/api/predios/${pid}/comments`,'POST',{body:d.body});await refresh(true);toast('Comentario registrado en bitácora.');return}
 if(cmd==='upload-doc'){
  const file=form.querySelector('input[name="file"]').files[0];
  if(!file)throw Error('Selecciona un archivo.');
  if(file.size>45*1024*1024)throw Error('El archivo supera el máximo de 45 MB.');
  // Sólo se exige la foto; si trae GPS en sus metadatos se aprovecha, sin pedir la ubicación del dispositivo.
  const geo=window.VEOGeoFoto?await window.VEOGeoFoto.geoForFile(file,{required:false}).catch(()=>null):null;
  const signed=await api(`/api/predios/${pid}/documents/sign`,{method:'POST',body:JSON.stringify({doc_type:d.doc_type,original_filename:file.name,size_bytes:file.size})});
  const uploaded=await fetch(signed.url,{method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
  if(!uploaded.ok)throw Error('No se pudo cargar el archivo al almacenamiento seguro ('+uploaded.status+').');
  await api(`/api/predios/${pid}/documents/complete`,{method:'POST',body:JSON.stringify({doc_type:d.doc_type,original_filename:file.name,storage_path:signed.storage_path,...(geo||{})})});
  await refresh(true);toast(geo?(geo.geo_source==='exif'?'Foto adjuntada con la ubicación GPS de la cámara.':'Foto adjuntada con la ubicación del dispositivo.'):'Documento adjuntado y disponible para el equipo.');return;
 }
}
document.addEventListener('input',ev=>{
 if(ev.target?.id==='picker-corridor-query')pickerCorridorOptions(ev.target.value);
});
document.addEventListener('focusin',ev=>{
 if(ev.target?.id==='picker-corridor-query')pickerCorridorOptions(ev.target.value.replace(/^\d{2}\s*·\s*/,''));
});
document.addEventListener('submit',async ev=>{const form=ev.target.closest('form[data-form]');if(!form)return;ev.preventDefault();const btn=form.querySelector('[type="submit"]');if(btn){btn.disabled=true;btn.dataset.old=btn.textContent;btn.textContent='PROCESANDO…'}try{await forms(form)}catch(e){toast(e.message,true);if(btn){btn.disabled=false;btn.textContent=btn.dataset.old}}});
// Cierre de sesión por inactividad: 15 minutos sin tocar, escribir ni desplazarse.
// El servidor aplica el mismo límite (la cookie se renueva en cada petición y con /api/ping).
(function(){
 const IDLE=15*60*1000,PING=4*60*1000;let last=Date.now(),lastPing=Date.now(),timer=null;
 const active=()=>!!state.user&&!shell.classList.contains('hidden');
 async function expire(){
  clearTimeout(timer);if(!active())return;
  try{await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:'{}',credentials:'same-origin'})}catch(_){}
  try{closeMap();document.getElementById('modal').innerHTML='';document.getElementById('location-picker').innerHTML='';closeDrawer()}catch(_){}
  loginScreen();toast('Sesión cerrada tras 15 minutos de inactividad. Vuelve a iniciar sesión.',true);
 }
 function arm(){clearTimeout(timer);timer=setTimeout(check,Math.max(1000,IDLE-(Date.now()-last)))}
 function check(){if(!active())return;if(Date.now()-last>=IDLE){expire();return}arm()}
 function poke(){
  if(!active())return;const now=Date.now();if(now-last>=IDLE){expire();return}
  last=now;if(!timer)arm();
  if(now-lastPing>PING){lastPing=now;fetch('/api/ping',{credentials:'same-origin'}).then(r=>{if(r.status===401)loginScreen()}).catch(()=>{})}
 }
 ['pointerdown','keydown','wheel','touchstart','scroll','mousemove'].forEach(e=>window.addEventListener(e,poke,{passive:true,capture:true}));
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check()});
 window.veoIdleReset=()=>{last=lastPing=Date.now();arm()};
})();
(async()=>{try{await loadAll()}catch(err){console.warn('Sesión no disponible:',err.message);loginScreen()}})();


// Consola: localStorage.getItem('veo_territorios_demo_v1') conserva la copia local previa.