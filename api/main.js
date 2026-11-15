/* VEO Territorios · API multiusuario en Vercel (Node.js nativo, sin paquetes).
 * Almacén: Supabase PostgreSQL + Storage. La SERVICE ROLE KEY sólo vive en Vercel.
 * Sesiones: cookies HTTPOnly firmadas, revocadas en la siguiente petición si se cambia contraseña o se desactiva la cuenta.
 */
'use strict';
const crypto=require('node:crypto');
const { promisify }=require('node:util');
const scrypt=promisify(crypto.scrypt);
const PHASES=['BUSQUEDA_FACTIBILIDAD','PRIMER_CONTACTO','SEGUIMIENTO','CIERRE'];
const WEIGHTS={flujo:30,visibilidad:25,urbana:15,electrica:10,propietario:10,comercial:10};
const DOC_TYPES=new Set(['foto','satelital','dron','carta_intencion','contrato','mecanica_suelos','memoria_calculo','factibilidad_electrica','permiso_municipal','otro']);
const ROLES=new Set(['admin','supervisor','broker','legal','tecnico']);
const COOKIE='veo_sesion', SECONDS=7*24*60*60, MAX_FILE=45*1024*1024;
const codeError=(status,detail)=>Object.assign(new Error(detail),{status});
const ensure=(ok,msg,status=400)=>{if(!ok)throw codeError(status,msg)};
const env=()=>{
 const {SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_SECRET_KEY,VEO_SESSION_SECRET}=process.env;
 const key=String(SUPABASE_SECRET_KEY||SUPABASE_SERVICE_ROLE_KEY||'').trim();
 ensure(SUPABASE_URL&&key&&VEO_SESSION_SECRET&&VEO_SESSION_SECRET.length>=32,'Servidor sin configurar: faltan variables de Supabase o secreto de sesión.',503);
 return {url:SUPABASE_URL.replace(/\/$/,''),key,secret:VEO_SESSION_SECRET};
};
// Las claves sb_secret_* no son JWT; pasan sólo por el encabezado apikey.
const apiHeaders=()=>{const {key}=env();const headers={'apikey':key,'Accept':'application/json'};if(!key.startsWith('sb_secret_'))headers['Authorization']=`Bearer ${key}`;return headers;};
function qs(obj){const u=new URLSearchParams();for(const [k,v] of Object.entries(obj||{}))if(v!==null&&v!==undefined)u.set(k,String(v));return u.toString()}
async function rest(table,{query={},method='GET',data,returning=true}={}){
 const {url}=env(),suffix=qs(query),endpoint=`${url}/rest/v1/${table}${suffix?'?'+suffix:''}`;
 const h={...apiHeaders()};if(method!=='GET'){h['Content-Type']='application/json';h['Prefer']=returning?'return=representation':'return=minimal';}
 const r=await fetch(endpoint,{method,headers:h,body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(20000)});
 let obj=null;try{obj=await r.json()}catch(_){obj=null}
 if(!r.ok){if(r.status===401){const k=env().key;const kind=k.startsWith('sb_secret_')?'sb_secret':k.startsWith('eyJ')?'legacy_jwt':k.startsWith('sb_publishable_')?'publishable':'other';console.error('VEO_AUTH_DIAG',{key_kind:kind,key_length:k.length,code:obj?.code||'',message:String(obj?.message||'').slice(0,150)})}console.error('DB',r.status,table,obj?.code||'');if(r.status===409||obj?.code==='23505')throw codeError(409,'Registro duplicado.');throw codeError(502,'No fue posible completar la operación en la base de datos.');}
 return obj||[];
}
const list=(table,q={})=>rest(table,{query:{select:'*',...q}});
const one=async(table,q)=> (await list(table,{...q,limit:1}))[0]||null;
const add=async(table,data)=> (await rest(table,{method:'POST',data}))[0];
const patch=async(table,id,data)=> (await rest(table,{query:{id:`eq.${id}`},method:'PATCH',data}))[0];
const remove=async(table,id)=> rest(table,{query:{id:`eq.${id}`},method:'DELETE'});
const safeUser=u=>{const {password_hash,session_version,...safe}=u;return safe};
async function hashPassword(password){const salt=crypto.randomBytes(20).toString('hex');const hash=await scrypt(String(password),salt,64);return `scrypt$${salt}$${hash.toString('hex')}`}
async function checkPassword(password,stored){try{const [method,salt,hex]=stored.split('$');if(method!=='scrypt')return false;const storedBuf=Buffer.from(hex,'hex');const actual=await scrypt(String(password),salt,storedBuf.length);return crypto.timingSafeEqual(storedBuf,actual)}catch(_){return false}}
const mac=(value)=>crypto.createHmac('sha256',env().secret).update(value).digest('base64url');
function signedSession(user){const data=Buffer.from(JSON.stringify({sub:user.id,sv:user.session_version,exp:Date.now()+SECONDS*1000})).toString('base64url');return data+'.'+mac(data)}
function decodeSession(token){try{const [b,signature]=token.split('.');if(!b||!signature||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(mac(b))))return null;const d=JSON.parse(Buffer.from(b,'base64url').toString());return d.exp>Date.now()?d:null}catch(_){return null}}
const getCookie=(req,key)=>{const s=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(key+'='));return s?decodeURIComponent(s.slice(key.length+1)):null};
const setSession=(res,user)=>{const token=signedSession(user);res.setHeader('Set-Cookie',`${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SECONDS}; HttpOnly; Secure; SameSite=Lax`);return token};
const clearSession=res=>res.setHeader('Set-Cookie',`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
function send(res,status,obj){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(obj))}
const audit=(me,predio_id,kind,detail)=>add('veo_activity',{predio_id:predio_id||null,user_id:me.id,user_name:me.display_name,kind,detail});
const mayManage=u=>['admin','supervisor'].includes(u.role);
const canSee=(u,p)=>u.role!=='broker'||+p.broker_id===+u.id||+p.created_by===+u.id;
const canEdit=(u,p)=>canSee(u,p)&&(u.role!=='broker'||+p.broker_id===+u.id||+p.created_by===+u.id);
async function predioFor(me,id){const p=await one('veo_predios',{id:`eq.${id}`});ensure(p&&canSee(me,p),'No existe el predio o no tienes permiso.',404);return p}
const cleanText=(v,max=2000)=>String(v??'').trim().slice(0,max);
const validUsername=(str)=>/^[a-zA-Z0-9._-]{3,50}$/.test(str);
const reqItems=(p,docs,to)=>{const found=t=>docs.some(x=>x.doc_type===t),items=[];const push=(label,done)=>items.push({key:label,label,done:!!done});
 if(to==='PRIMER_CONTACTO'){push('Broker asignado',p.broker_id);push('Ubicación y corredor verificados (pin GPS)',p.lat!=null&&p.lng!=null&&p.geo_status==='verificado');push('Fotografía del predio',found('foto'));push('Evidencia de mapa satelital',found('satelital'));push('Video con dron (archivo o enlace en expediente)',found('dron')||/^https?:\/\//.test(p.dron_url||''));push('Calificación ≥70/100',p.score>=70)}
 if(to==='SEGUIMIENTO'){push('Nombre del dueño / administrador',p.propietario);push('Teléfono o correo de contacto',p.telefono||p.email);push('Fecha del primer contacto',p.fecha_contacto);push('Respuesta no descartada',['evaluando','interesado'].includes(p.interes))}
 if(to==='CIERRE'){push('Carta de intención presentada',found('carta_intencion'));push('Interés confirmado del propietario',p.interes==='interesado');push('Condición de permiso municipal explicada',p.clausula_condicional)}return items;
};
function readiness(p,docs){const x=[['contrato','Contrato firmado / condicionado'],['mecanica_suelos','Estudio de mecánica de suelos'],['memoria_calculo','Memoria de cálculo estructural'],['factibilidad_electrica','Factibilidad eléctrica'],['permiso_municipal','Documento de permiso municipal']].map(([key,label])=>({key,label,done:docs.some(d=>d.doc_type===key)}));x.push({key:'permiso',label:'Permiso municipal autorizado',done:p.permiso_status==='autorizado'},{key:'clausula',label:'Cláusula suspensiva reconocida',done:!!p.clausula_condicional});return {complete:p.phase==='CIERRE'&&x.every(q=>q.done),items:x}}
// ── Límite de intentos (anti fuerza bruta) ──
const LOGIN_USER_MAX=5, LOGIN_IP_MAX=20, LOGIN_WINDOW_S=900, LOGIN_LOCK_S=900;
const DUMMY_HASH='scrypt$00000000000000000000000000000000000000$'+'0'.repeat(128);
const clientIp=req=>String(req?.headers?.['x-real-ip']||String(req?.headers?.['x-forwarded-for']||'').split(',')[0]||'desconocida').trim().slice(0,64);
async function rpc(fn,args){try{return await rest('rpc/'+fn,{method:'POST',data:args})}catch(e){console.error('VEO_RATE_LIMIT',fn,e.message);return null}}
function tooMany(res,secs){res.setHeader('Retry-After',String(secs));return codeError(429,`Demasiados intentos fallidos. Espera ${Math.ceil(secs/60)} minutos e inténtalo de nuevo.`)}
// ── Georreferencia de fotografías ──
const IMAGE_EXT=/\.(jpe?g|png|webp|heic|heif)$/i;
const DISPLAY_EXT=/\.(jpe?g|png|webp)$/i;
const isDisplayPhoto=d=>d.doc_type==='foto'&&DISPLAY_EXT.test(String(d.original_filename||d.storage_path||''));
const VIDEO_EXT=/\.(mp4|mov|m4v|webm)$/i;
const mediaKind=d=>{const n=String(d.original_filename||d.storage_path||'');if(VIDEO_EXT.test(n))return 'video';if(['foto','satelital','dron'].includes(d.doc_type)&&DISPLAY_EXT.test(n))return 'img';return null};
const mediaItem=d=>({id:d.id,kind:mediaKind(d),by:d.uploaded_by_name||'',at:d.taken_at||d.created_at,name:d.original_filename||''});
function mediaByPredio(documents){const m={};for(const d of documents){if(!mediaKind(d))continue;(m[d.predio_id]=m[d.predio_id]||[]).push(d)}for(const k in m)m[k]=m[k].sort((a,b)=>b.id-a.id).slice(0,12).map(mediaItem);return m}
function docGeo(b){
 const isPhoto=b.doc_type==='foto'&&IMAGE_EXT.test(String(b.original_filename||b.storage_path||''));
 if(b.geo_lat===undefined||b.geo_lat===null||b.geo_lat===''){ensure(!isPhoto,'La fotografía del predio debe estar georreferenciada (GPS de la foto o ubicación del dispositivo).');return{}}
 const lat=Number(b.geo_lat),lng=Number(b.geo_lng);
 ensure(Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180,'Coordenadas de la foto inválidas.');
 ensure(['exif','dispositivo'].includes(b.geo_source),'Origen de ubicación inválido.');
 const acc=b.geo_accuracy_m==null||b.geo_accuracy_m===''?null:Math.round(Number(b.geo_accuracy_m));
 ensure(acc===null||(Number.isFinite(acc)&&acc>=0&&acc<=100000),'Precisión de ubicación inválida.');
 let taken=null;if(b.taken_at){const t=new Date(b.taken_at);ensure(!isNaN(t)&&t.getTime()<Date.now()+864e5,'Fecha de la foto inválida.');taken=t.toISOString()}
 return{geo_lat:+lat.toFixed(7),geo_lng:+lng.toFixed(7),geo_source:b.geo_source,geo_accuracy_m:acc,taken_at:taken};
}
async function login(body,res,req){
 const username=cleanText(body.username,50).toLowerCase();ensure(username&&body.password,'Introduce usuario y contraseña.');
 const ip=clientIp(req),userKey='u:'+username,ipKey='ip:'+ip;
 const wait=Number(await rpc('veo_login_check',{p_keys:[userKey,ipKey]}))||0;
 if(wait>0)throw tooMany(res,wait);
 let u=await one('veo_users',{username:`eq.${username}`});
 // Sólo al iniciar la instalación, ADMIN se registra con la contraseña secreta del entorno.
 if(!u&&username==='admin'&&process.env.VEO_ADMIN_BOOTSTRAP_PASSWORD){const others=await list('veo_users',{limit:1});if(others.length===0){
  ensure(String(body.password)===process.env.VEO_ADMIN_BOOTSTRAP_PASSWORD,'Credenciales incorrectas.',401);
  ensure(String(body.password).length>=12,'La contraseña de arranque requiere 12 caracteres.',400);
  try{u=await add('veo_users',{username:'admin',display_name:'Administrador VEO',role:'admin',active:true,must_change_password:true,password_hash:await hashPassword(body.password)});}catch(e){u=await one('veo_users',{username:'eq.admin'})}
 }}
 const match=u&&u.active?await checkPassword(body.password,u.password_hash):(await checkPassword(body.password,DUMMY_HASH),false);
 if(!match){
  const [lu,li]=await Promise.all([rpc('veo_login_fail',{p_key:userKey,p_max:LOGIN_USER_MAX,p_window_s:LOGIN_WINDOW_S,p_lock_s:LOGIN_LOCK_S}),rpc('veo_login_fail',{p_key:ipKey,p_max:LOGIN_IP_MAX,p_window_s:LOGIN_WINDOW_S,p_lock_s:LOGIN_LOCK_S})]);
  const locked=Math.max(Number(lu)||0,Number(li)||0);
  if(locked>0)throw tooMany(res,locked);
  throw codeError(401,'Credenciales incorrectas.');
 }
 await rpc('veo_login_reset',{p_key:userKey});
 setSession(res,u);return {ok:true};
}
async function session(req,res){const token=getCookie(req,COOKIE),sess=token&&decodeSession(token);ensure(sess,'Inicia sesión.',401);
 const u=await one('veo_users',{id:`eq.${Number(sess.sub)}`});ensure(u&&u.active&&u.session_version===sess.sv,'Sesión inválida o cuenta desactivada.',401);
 return {u,csrf:mac('csrf:'+token)};
}
function validateOrigin(req){const origin=req.headers.origin;if(origin){const forwarded=req.headers['x-forwarded-host']||req.headers.host;const expected=`https://${forwarded}`;ensure(origin===expected,'Origen de solicitud no permitido.',403)} }
async function storage(method,path,body=null){const {url}=env();const h=apiHeaders();if(body!==null)h['Content-Type']='application/json';const r=await fetch(url+'/storage/v1/'+path,{method,headers:h,body:body===null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const data=await r.json().catch(()=>({}));if(!r.ok){console.error('Storage',r.status,data?.statusCode);throw codeError(502,'No se pudo acceder al almacenamiento privado de archivos.')}return data}
const encodedPath=p=>p.split('/').map(encodeURIComponent).join('/');
const signedLink=(data,path,kind)=>{const token=new URL(data.url||data.signedURL||'','https://supabase.invalid').searchParams.get('token');ensure(token,'No fue posible firmar el archivo.',502);return `${env().url}/storage/v1/object/${kind}/veo-documentos/${encodedPath(path)}?token=${encodeURIComponent(token)}`};
async function validateGeo(id,point){
 const lat=+point.lat,lng=+point.lng;ensure(id>=1&&id<=14&&Number.isFinite(lat)&&Number.isFinite(lng),'Coordenadas inválidas.');
 if(lat<25.2||lat>26.3||lng< -101.4||lng> -99.5)return {ok:false,status:'outside',message:'Ubicación fuera del área metropolitana de estudio.'};
 const names={1:['paseo de los leones','paseo leones'],2:['garza sada'],3:['constitucion'],4:['lazaro cardenas'],5:['gonzalitos','eleuterio gonzalez'],6:['morones prieto'],7:['nogalar'],8:['miguel aleman'],9:['pablo livas'],10:['benito juarez'],11:['ruiz cortines'],12:['abraham lincoln'],13:['felix u gomez'],14:['madero']};
 const fold=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const q=`[out:json][timeout:9];way(around:350,${lat.toFixed(7)},${lng.toFixed(7)})["highway"]["name"];out tags geom;`;
 try{
  const r=await fetch('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(q),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(8500)});ensure(r.ok,'Servicio geográfico no disponible.',503);const data=await r.json();let min=Infinity,nm='';
  const segment=(a,b)=>{const sx=111320*Math.cos(lat*Math.PI/180),sy=111195,px=lng*sx,py=lat*sy,ax=a.lon*sx,ay=a.lat*sy,bx=b.lon*sx,by=b.lat*sy,dx=bx-ax,dy=by-ay,t=dx*dx+dy*dy?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy))):0;return Math.hypot(px-(ax+t*dx),py-(ay+t*dy))};
  for(const w of data.elements||[]){const vals=['name','name:es','alt_name','official_name','short_name','loc_name'].map(k=>fold(w.tags?.[k]));if(!vals.some(x=>names[id]?.some(n=>x.includes(n)))||!w.geometry?.length)continue;
   const geom=w.geometry;for(let j=1;j<geom.length;j++){const d=segment(geom[j-1],geom[j]);if(d<min){min=d;nm=w.tags?.name||''}}}
  if(!Number.isFinite(min))return{ok:false,status:'unavailable',message:'No se identificó cartografía suficiente. La ubicación queda pendiente.'};
  return min<=100?{ok:true,status:'validated',distance_m:+min.toFixed(1),street:nm,message:`Pin a ${Math.round(min)} m del corredor.`}:{ok:false,status:'outside',distance_m:+min.toFixed(1),message:'Fuera del radio de 100 m del corredor seleccionado.'};
 }catch(e){return{ok:false,status:'unavailable',message:'Servicio cartográfico temporalmente inaccesible; el predio quedará pendiente.'}}
}
async function handle(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const method=req.method||'GET';const parts=String(req.query.route||'').split('/').filter(Boolean);const key=parts.join('/');
 ensure(['GET','POST','PATCH','DELETE'].includes(method),'Método no permitido.',405);env();
 if(method!=='GET')validateOrigin(req);
 if(key==='health'&&method==='GET'){await list('veo_users',{select:'id',limit:1});return {ok:true,service:'veo-territorios',mode:'multiusuario',database:'connected'};}
 if(key==='login'&&method==='POST')return login(req.body||{},res,req);
 const {u:me,csrf}=await session(req,res);
 if(method!=='GET')ensure(req.headers['x-csrf-token']===csrf,'Token de seguridad inválido. Recarga la aplicación.',403);
 const b=req.body||{};
 if(key==='logout'&&method==='POST'){clearSession(res);return {ok:true}}
 if(key==='me/password'&&method==='POST'){
  ensure(await checkPassword(b.current_password,me.password_hash),'La contraseña actual no coincide.');ensure(typeof b.new_password==='string'&&b.new_password.length>=10&&b.new_password.length<=128,'Contraseña nueva: entre 10 y 128 caracteres.');ensure(b.new_password!==b.current_password,'La nueva contraseña debe ser diferente.');
  await patch('veo_users',me.id,{password_hash:await hashPassword(b.new_password),must_change_password:false,password_changed_at:new Date().toISOString(),credential_updated_at:new Date().toISOString(),session_version:me.session_version+1});
  const updated=await one('veo_users',{id:`eq.${me.id}`});setSession(res,updated);await audit(me,null,'credenciales',`Cambió contraseña de ${me.username}`);return {ok:true};
 }
 if(key==='bootstrap'&&method==='GET'){
  const result={user:safeUser(me),csrf,must_change_password:me.must_change_password};
  if(me.must_change_password)return result;
  const [users,ps,documents,requests,activity]=await Promise.all([list('veo_users',{order:'id.asc'}),list('veo_predios',{order:'updated_at.desc',limit:3000}),list('veo_documents',{limit:10000}),list('veo_requests',{order:'created_at.desc',limit:1000}),list('veo_activity',{order:'created_at.desc',limit:50})]);
  const visible=ps.filter(p=>p.active&&canSee(me,p));const ids=new Set(visible.map(p=>p.id));const names=Object.fromEntries(users.map(x=>[x.id,x.display_name]));
  const media=mediaByPredio(documents);
  return {...result,maps_js_key:String(process.env.VEO_GOOGLE_MAPS_KEY||'').trim(),users:(mayManage(me)?users:users.filter(x=>x.active&&x.role==='broker')).map(safeUser),predios:visible.map(p=>({...p,broker_name:names[p.broker_id]||'Sin asignar',docs_count:documents.filter(d=>d.predio_id===p.id).length,media:media[p.id]||[],pending_count:requests.filter(r=>r.predio_id===p.id&&r.status==='pendiente').length})),requests:requests.filter(r=>ids.has(r.predio_id)),photos:documents.filter(d=>ids.has(d.predio_id)&&d.geo_lat!=null&&d.geo_lng!=null).map(d=>({id:d.id,predio_id:d.predio_id,lat:d.geo_lat,lng:d.geo_lng,source:d.geo_source,filename:d.original_filename,media:mediaKind(d)?[mediaItem(d)]:[],taken_at:d.taken_at||d.created_at})),activity:activity.filter(a=>a.predio_id==null||ids.has(a.predio_id)),corridors:null,weights:WEIGHTS};
 }
 ensure(!me.must_change_password,'Debes cambiar la contraseña temporal antes de continuar.',403);
 if(key==='users'&&method==='POST'){
  ensure(me.role==='admin','Sólo el administrador gestiona credenciales.',403);
  const username=cleanText(b.username,50).toLowerCase(),password=String(b.password||''),role=b.role||'broker';ensure(validUsername(username),'El usuario debe tener 3-50 caracteres (letras, números, punto, guion o _).');ensure(password.length>=10&&password.length<=128,'La contraseña temporal debe tener entre 10 y 128 caracteres.');ensure(ROLES.has(role),'Rol no válido.');
  const user=await add('veo_users',{username,display_name:cleanText(b.display_name,120)||username,role,active:true,must_change_password:true,password_hash:await hashPassword(password)});await audit(me,null,'credenciales',`Creó cuenta ${user.username}`);return {ok:true,id:user.id};
 }
 if(parts[0]==='users'&&parts[1]&&['PATCH','DELETE'].includes(method)){
  ensure(me.role==='admin','Sólo el administrador gestiona credenciales.',403);const target=await one('veo_users',{id:`eq.${+parts[1]}`});ensure(target,'Usuario inexistente.',404);
  if(method==='DELETE'){ensure(target.role==='broker','La baja sólo se aplica a brokers.');ensure(target.id!==me.id,'No puedes darte de baja.');await patch('veo_users',target.id,{active:false,session_version:target.session_version+1});await audit(me,null,'credenciales',`Baja de broker ${target.username}`);const assoc=await list('veo_predios',{select:'id',broker_id:`eq.${target.id}`});return{ok:true,predios_preservados:assoc.length}}
  ensure(ROLES.has(b.role??target.role),'Rol no válido.');const update={display_name:cleanText(b.display_name??target.display_name,120),role:b.role??target.role,active:b.active!==undefined?!!b.active:target.active};
  if(target.id===me.id)ensure(update.active&&update.role==='admin'&&!b.password,'Utiliza Mi contraseña; no puedes retirar tu propio acceso.');
  if(b.password){ensure(String(b.password).length>=10&&String(b.password).length<=128,'Contraseña temporal entre 10 y 128 caracteres.');update.password_hash=await hashPassword(b.password);update.must_change_password=true;update.credential_updated_at=new Date().toISOString()}
  update.session_version=target.session_version+1;await patch('veo_users',target.id,update);await audit(me,null,'credenciales',`Actualizó cuenta ${target.username}`);
  if(target.id===me.id){const refreshed=await one('veo_users',{id:`eq.${me.id}`});setSession(res,refreshed)}return{ok:true};
 }
 if(key==='export.csv'&&method==='GET'){
  ensure(mayManage(me),'Sólo supervisión puede exportar predios.',403);
  const [ps,users]=await Promise.all([list('veo_predios',{limit:5000}),list('veo_users')]);const names=Object.fromEntries(users.map(u=>[u.id,u.display_name]));
  const cols=['id','code','alias','corridor_id','municipio','direccion','lat','lng','phase','score','broker_id','broker_name','propietario','telefono','email','active','created_at'];
  const csv=[cols.join(','),...ps.map(p=>cols.map(k=>{const value=k==='broker_name'?names[p.broker_id]||'':p[k]??'';return '"'+String(value).replaceAll('"','""')+'"'}).join(','))].join('\r\n');
  res.statusCode=200;res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="veo-territorios-predios.csv"');res.end('\uFEFF'+csv);return null;
 }
 if(key==='archives'&&method==='GET'){ensure(mayManage(me),'Sólo supervisión puede consultar archivos.',403);const [ps,users]=await Promise.all([list('veo_predios',{active:'eq.false',limit:2000}),list('veo_users')]);const names=Object.fromEntries(users.map(x=>[x.id,x.display_name]));return {predios:ps.map(p=>({...p,broker_name:names[p.broker_id]||'—'}))}}
 if(key==='geo/validate'&&method==='POST')return validateGeo(+b.corridor_id,{lat:b.lat,lng:b.lng});
 if(key==='predios'&&method==='POST'){
  ensure(b.alias&&+b.corridor_id>=1&&+b.corridor_id<=14&&b.lat!=null&&b.lng!=null,'Completa alias, corredor y pin GPS.');
  const geo=await validateGeo(+b.corridor_id,{lat:b.lat,lng:b.lng});ensure(geo.status!=='outside',geo.message);
  const broker=me.role==='broker'?me.id:(b.broker_id?+b.broker_id:null);
  if(broker){const assigned=await one('veo_users',{id:`eq.${broker}`});ensure(assigned?.active&&assigned.role==='broker','Selecciona un broker activo.')}
  let p=await add('veo_predios',{corridor_id:+b.corridor_id,alias:cleanText(b.alias,240),broker_id:broker,lat:+b.lat,lng:+b.lng,geo_status:geo.ok?'verificado':'pendiente',geo_checked_at:new Date().toISOString(),created_by:me.id});
  p=await patch('veo_predios',p.id,{code:`VEO-${String(p.corridor_id).padStart(2,'0')}-${String(p.id).padStart(5,'0')}`});await audit(me,p.id,'alta',`Nuevo predio ${p.code}`);return{id:p.id,code:p.code};
 }
 if(parts[0]==='predios'&&parts[1]){
  const pid=Number(parts[1]);ensure(Number.isSafeInteger(pid)&&pid>0,'ID inválido.');const p=await predioFor(me,pid);
  if(parts.length===2&&method==='GET'){
   const [docs,comments,activity,requests]=await Promise.all([list('veo_documents',{predio_id:`eq.${pid}`,order:'created_at.asc'}),list('veo_comments',{predio_id:`eq.${pid}`,order:'created_at.asc'}),list('veo_activity',{predio_id:`eq.${pid}`,order:'created_at.asc'}),list('veo_requests',{predio_id:`eq.${pid}`,order:'created_at.desc'})]);
   return {predio:p,documents:docs,comments,history:activity.map(x=>({...x,author:x.user_name})),requests,next_requirements:p.phase==='CIERRE'?[]:reqItems(p,docs,PHASES[PHASES.indexOf(p.phase)+1]),readiness:readiness(p,docs),can_edit:canEdit(me,p)};
  }
  if(parts.length===2&&method==='PATCH'){
   ensure(canEdit(me,p),'No puedes editar este predio.',403);const allowed=['alias','municipio','direccion','referencia','dron_url','propietario','telefono','email','fecha_contacto','interes','fecha_carta','clausula_condicional','notas','ratings_json'];
   if(mayManage(me))allowed.push('broker_id','lat','lng','corridor_id');
   if(['admin','supervisor','legal'].includes(me.role))allowed.push('permiso_status');
   const up={};for(const f of allowed)if(Object.hasOwn(b,f))up[f]=b[f];
   for(const f of ['alias','municipio','direccion','referencia','dron_url','propietario','telefono','email','interes','notas'])if(f in up)up[f]=cleanText(up[f],f==='notas'?5000:500);
   for(const f of ['fecha_contacto','fecha_carta'])if(up[f]==='')up[f]=null;
   if('broker_id' in up){up.broker_id=up.broker_id?Number(up.broker_id):null;if(up.broker_id){const broker=await one('veo_users',{id:`eq.${up.broker_id}`});ensure(broker?.role==='broker'&&broker.active,'Broker no disponible.')}}
   if('permiso_status' in up&&up.permiso_status==='autorizado'){const docs=await list('veo_documents',{predio_id:`eq.${pid}`});ensure(docs.some(d=>d.doc_type==='permiso_municipal'),'Adjunta el permiso municipal antes de autorizar.');}
   if('ratings_json' in up){let r;try{r=JSON.parse(up.ratings_json)}catch{throw codeError(400,'Calificación inválida.')}up.score=Math.round(Object.keys(WEIGHTS).reduce((n,k)=>n+(+r[k]||0)*WEIGHTS[k]/5,0));ensure(up.score>=0&&up.score<=100,'Calificación fuera de rango.');}
   if(['lat','lng','corridor_id'].some(f=>f in up)){const id=Number(up.corridor_id??p.corridor_id),pt={lat:up.lat??p.lat,lng:up.lng??p.lng};if(id!==p.corridor_id||+pt.lat!==p.lat||+pt.lng!==p.lng){const geo=await validateGeo(id,pt);ensure(geo.status!=='outside',geo.message);up.geo_status=geo.ok?'verificado':'pendiente';up.geo_checked_at=new Date().toISOString();}}
   up.updated_at=new Date().toISOString();await patch('veo_predios',pid,up);await audit(me,pid,'edicion','Actualizó expediente');return{ok:true};
  }
  if(parts.length===2&&method==='DELETE'){
   ensure(me.role==='admin','Sólo ADMIN puede eliminar predios definitivamente.',403);ensure(b.confirmation_code===p.code,'Escribe el ID exacto del predio.');
   const docs=await list('veo_documents',{predio_id:`eq.${pid}`});await remove('veo_predios',pid);
   let pending=0;for(const d of docs)try{await storage('DELETE',`object/veo-documentos/${encodedPath(d.storage_path)}`)}catch(_){pending++}
   await audit(me,null,'eliminacion_permanente',`Eliminó definitivamente el expediente ${p.code}`);return{ok:true,deleted_code:p.code,files_cleanup_pending:pending};
  }
  if(parts[2]==='comments'&&method==='POST'){ensure(canEdit(me,p),'No puedes comentar.',403);ensure(cleanText(b.body,5000),'Comentario vacío.');await add('veo_comments',{predio_id:pid,user_id:me.id,author:me.display_name,body:cleanText(b.body,5000)});await audit(me,pid,'comentario','Agregó comentario');return{ok:true}}
  if(parts[2]==='archive'&&method==='POST'){ensure(mayManage(me),'Sólo supervisión puede archivar.',403);await patch('veo_predios',pid,{active:!!b.restore,updated_at:new Date().toISOString()});await audit(me,pid,'archivo',b.restore?'Restauró predio':'Archivó predio');return{ok:true}}
  if(parts[2]==='geo'&&parts[3]==='revalidate'&&method==='POST'){ensure(canEdit(me,p),'No tienes permiso.',403);const geo=await validateGeo(p.corridor_id,{lat:p.lat,lng:p.lng});const status=geo.ok?'verificado':geo.status==='outside'?'fuera_corredor':'pendiente';await patch('veo_predios',pid,{geo_status:status,geo_checked_at:new Date().toISOString()});await audit(me,pid,'geo',`Revalidación: ${status}`);return {result:geo,geo_status:status}}
  if(parts[2]==='request'&&method==='POST'){ensure(canEdit(me,p),'No puedes solicitar avance.',403);const to=PHASES[PHASES.indexOf(p.phase)+1];ensure(to,'El predio ya está en cierre.');const docs=await list('veo_documents',{predio_id:`eq.${pid}`});const missing=reqItems(p,docs,to).filter(x=>!x.done).map(x=>x.label);ensure(!missing.length,'Faltan requisitos: '+missing.join('; '));const pending=await list('veo_requests',{predio_id:`eq.${pid}`,status:'eq.pendiente'});ensure(!pending.length,'Ya hay una solicitud pendiente.');await add('veo_requests',{predio_id:pid,from_phase:p.phase,to_phase:to,code:p.code,alias:p.alias,requester_name:me.display_name,reason:cleanText(b.reason,500)});await audit(me,pid,'solicitud',`Solicitó avance a ${to}`);return {ok:true}}
  if(parts[2]==='documents'&&parts[3]==='sign'&&method==='POST'){
   ensure(canEdit(me,p),'Sin permiso para adjuntar.',403);ensure(DOC_TYPES.has(b.doc_type),'Tipo documental no válido.');ensure(Number.isSafeInteger(b.size_bytes)&&b.size_bytes>0&&b.size_bytes<=MAX_FILE,'El archivo debe ser de máximo 45 MB.');
   const filename=cleanText(b.original_filename,180).replace(/[^a-zA-Z0-9._-]/g,'_');const path=`${pid}/${crypto.randomUUID()}-${filename}`;
   const result=await storage('POST',`object/upload/sign/veo-documentos/${encodedPath(path)}`,{});
   return {url:signedLink(result,path,'upload/sign'),storage_path:path,filename};
  }
  if(parts[2]==='documents'&&parts[3]==='complete'&&method==='POST'){
   ensure(canEdit(me,p),'Sin permiso para adjuntar.',403);ensure(DOC_TYPES.has(b.doc_type)&&typeof b.storage_path==='string'&&b.storage_path.startsWith(`${pid}/`)&&b.storage_path.length<400,'Archivo inválido.');const geo=docGeo(b);
   const exists=await list('veo_documents',{storage_path:`eq.${b.storage_path}`,limit:1});ensure(!exists.length,'Archivo previamente registrado.');
   const info=await storage('GET',`object/info/veo-documentos/${encodedPath(b.storage_path)}`);const size=Number(info?.metadata?.size||info?.size||0);ensure(size>0&&size<=MAX_FILE,'No se localizó el archivo cargado o supera el límite.');
   await add('veo_documents',{predio_id:pid,doc_type:b.doc_type,storage_path:b.storage_path,original_filename:cleanText(b.original_filename,180),size_bytes:size,uploaded_by_name:me.display_name,...geo});await audit(me,pid,'documento',`Adjuntó ${b.doc_type}`);return{ok:true};
  }
 }
 if(parts[0]==='requests'&&parts[2]==='resolve'&&method==='POST'){
  ensure(mayManage(me),'Sólo supervisión puede aprobar.',403);const r=await one('veo_requests',{id:`eq.${+parts[1]}`});ensure(r&&r.status==='pendiente','Solicitud ya resuelta o inexistente.',404);const p=await predioFor(me,r.predio_id);ensure(['aprobada','rechazada'].includes(b.decision),'Decisión inválida.');
  if(b.decision==='aprobada'){const docs=await list('veo_documents',{predio_id:`eq.${p.id}`});const missing=reqItems(p,docs,r.to_phase).filter(x=>!x.done);ensure(!missing.length,'Faltan requisitos: '+missing.map(x=>x.label).join('; '));await patch('veo_predios',p.id,{phase:r.to_phase,updated_at:new Date().toISOString()})}
  await patch('veo_requests',r.id,{status:b.decision,review_note:cleanText(b.review_note,500)});await audit(me,p.id,'fase',`Solicitud ${b.decision}: ${r.to_phase}`);return{ok:true};
 }
 if(parts[0]==='documents'&&parts[1]){
  const d=await one('veo_documents',{id:`eq.${+parts[1]}`});ensure(d,'Documento no encontrado.',404);const p=await predioFor(me,d.predio_id);
  if(parts[2]==='content'&&method==='GET'){
   const result=await storage('POST',`object/sign/veo-documentos/${encodedPath(d.storage_path)}`,{expiresIn:900});res.statusCode=302;res.setHeader('Location',signedLink(result,d.storage_path,'sign'));res.end();return null;
  }
  if(parts.length===2&&method==='DELETE'){ensure(canEdit(me,p),'Sin permiso para eliminar documentos.',403);await remove('veo_documents',d.id);try{await storage('DELETE',`object/veo-documentos/${encodedPath(d.storage_path)}`)}catch(_){console.warn('Pendiente de limpieza',d.id)}await audit(me,p.id,'documento','Eliminó documento');return{ok:true}}
 }
 throw codeError(404,'Ruta de API no encontrada.');
}
module.exports=async function(req,res){try{const data=await handle(req,res);if(!res.writableEnded)send(res,200,data===undefined?{ok:true}:data)}catch(e){const status=e.status||500;if(status>=500)console.error('VEO API',status,e.message);if(!res.writableEnded)send(res,status,{detail:e.status?e.message:'Error interno del servidor.'})}};
// Sólo para tests locales, no expone ninguna ruta adicional de servicio.
module.exports._internal={handle,hashPassword,checkPassword,signedSession,decodeSession};