
/* VEO · comprobación de proximidad a ejes viales con trazados OSM en línea.
   La cercanía se mide en metros sobre geometrías reales de carreteras, no
   sobre los centros orientativos del PDF. Sin datos: no se valida el predio. */
(function(){'use strict';
const aliases={
 1:['paseo de los leones','paseo leones'],2:['garza sada','eugenio garza sada','carretera nacional'],3:['constitucion'],4:['lazaro cardenas'],
 5:['gonzalitos','eleuterio gonzalez','jose eleuterio gonzalez'],6:['morones prieto','ignacio morones prieto'],
 7:['nogalar'],8:['miguel aleman','boulevard aeropuerto','blvd aeropuerto','bulevar aeropuerto'],9:['pablo livas'],10:['benito juarez'],11:['ruiz cortines'],12:['abraham lincoln','av lincoln'],
 13:['felix uresti gomez','felix u gomez'],14:['francisco i madero','madero'],15:['manuel l barragan','manuel luis barragan']};
const fold=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
function named(id,tags){return ['name','name:es','official_name','alt_name','short_name','loc_name'].some(k=>aliases[id]?.some(a=>fold(tags?.[k]).includes(fold(a))))}
function segment(p,a,b){const sy=111195,sx=111320*Math.cos(p.lat*Math.PI/180),px=p.lng*sx,py=p.lat*sy,ax=a.lon*sx,ay=a.lat*sy,bx=b.lon*sx,by=b.lat*sy,dx=bx-ax,dy=by-ay;const t=dx*dx+dy*dy?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy))):0;return Math.hypot(px-(ax+t*dx),py-(ay+t*dy))}
function distance(p,arr){if(!arr?.length)return Infinity;if(arr.length===1)return segment(p,arr[0],arr[0]);let min=Infinity;for(let i=1;i<arr.length;i++)min=Math.min(min,segment(p,arr[i-1],arr[i]));return min}
function evaluate(id,p,ways){let best=Infinity,name='',other=Infinity,otherName='';for(const w of ways){if(w.type!=='way'||!w.geometry?.length)continue;const dist=distance(p,w.geometry);if(named(id,w.tags)){if(dist<best){best=dist;name=w.tags?.name||''}}else if(dist<other){other=dist;otherName=w.tags?.name||''}}
 if(!Number.isFinite(best))return {status:'unavailable',ok:false,message:'La fuente cartográfica no identifica con certeza esta avenida. Puedes guardar el pin como PENDIENTE de validación; no quedará aprobado automáticamente.'};
 if(best<=100)return {status:'validated',ok:true,street:name,distance_m:+best.toFixed(1),message:`Pin a ${Math.round(best)} m del eje vial «${name}». Dentro del radio de prospección (100 m).`};
 return {status:'outside',ok:false,distance_m:Number.isFinite(best)?+best.toFixed(1):null,street:otherName,message:`Fuera del radio de 100 m del corredor seleccionado.${otherName?' Vía más cercana: '+otherName+'.':''} Ajusta el pin.`}
}

function evaluateTrace(id,p,trace){
 // The SAME named road centerline displayed in pink is used to validate the GPS point.
 if(!trace?.lines?.length||!['verified','cached'].includes(trace.status))return null;
 const q={lat:p.lat,lng:p.lng};let best=Infinity,closest=null;
 for(const line of trace.lines){for(let i=1;i<line.length;i++){
  const a=line[i-1],b=line[i];if(!Array.isArray(a)||!Array.isArray(b))continue;
  const A={lat:+a[0],lon:+a[1]},B={lat:+b[0],lon:+b[1]};
  if(![A.lat,A.lon,B.lat,B.lon].every(Number.isFinite))continue;
  const d=segment(q,A,B);if(d<best){best=d;closest=A}
 }}
 if(!Number.isFinite(best))return null;
 const distance_m=+best.toFixed(1),ok=best<=100;
 return {status:ok?'validated':'outside',ok,distance_m,source:'OSM / corredor trazado',
  message:ok?`Ubicación corroborada: ${distance_m} m del eje georreferenciado del corredor. Coordenadas GPS ${p.lat.toFixed(7)}, ${p.lng.toFixed(7)}.`:
  `Pin a ${distance_m} m del corredor seleccionado (máximo 100 m). Corrige la ubicación o selecciona la avenida que corresponda.`};
}
const cache=new Map();
async function validate(id,p,{signal}={}){
 id=+id;if(!aliases[id]||!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||p.lat<25.2||p.lat>26.3||p.lng< -101.4||p.lng> -99.5)return {status:'outside',ok:false,message:'La ubicación está fuera del área metropolitana de estudio.'};
 // Instant local check against a previously fetched authentic OSM geometry.
 const shape=window.VEORoutes?.cached?.(id),local=evaluateTrace(id,p,shape);
 if(local){return local}
 const key=`${id}:${p.lat.toFixed(6)}:${p.lng.toFixed(6)}`;
 const prev=cache.get(key);if(prev&&Date.now()-prev.ts<15*60*1000)return {...prev.value};
 const q=`[out:json][timeout:9];way(around:350,${p.lat.toFixed(7)},${p.lng.toFixed(7)})["highway"]["name"];out tags geom;`;
 try{
 const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),7500);
 let res; try{res=await fetch('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(q),{method:'GET',signal:signal||controller.signal,headers:{Accept:'application/json'}})}finally{clearTimeout(timer)}
 if(!res.ok)throw Error('HTTP '+res.status);
 const data=await res.json();if(!data.elements?.length)throw Error('Sin cartografía');
 const result=evaluate(id,p,data.elements);cache.set(key,{ts:Date.now(),value:result});return result;
 }catch(err){if(err?.name==='AbortError')throw err;return {status:'unavailable',ok:false,message:'La verificación cartográfica no está disponible en este momento. Puedes GUARDAR EL PREDIO COMO PENDIENTE; no se aprobará su ubicación ni podrá avanzar de fase hasta ser verificada.'}}
}
window.VEOCorridorGeo={validate,evaluate,evaluateTrace,aliases,fold};
})();

