
/* VEO · Geometría real de corredores identificados por nombre en OSM.
 * No dibuja líneas inventadas cuando el proveedor está inaccesible.
 */
(function(){'use strict';
const B={
 1:[25.670,-100.490,25.795,-100.325],2:[25.500,-100.336,25.692,-100.180],
 3:[25.640,-100.413,25.704,-100.235],4:[25.580,-100.410,25.693,-100.270],
 5:[25.651,-100.377,25.794,-100.323],6:[25.611,-100.425,25.695,-100.232],
 7:[25.698,-100.362,25.791,-100.232],8:[25.663,-100.319,25.830,-100.090],
 9:[25.604,-100.283,25.704,-100.113],10:[25.595,-100.271,25.707,-100.124],
 11:[25.703,-100.483,25.812,-100.162],12:[25.736,-100.515,25.828,-100.308],
 13:[25.642,-100.336,25.750,-100.260],14:[25.663,-100.366,25.701,-100.267]};
const P={1:'Leones',2:'Garza Sada|Carretera Nacional',3:'Constituci',4:'Lázaro|Lazaro|Cárdenas|Cardenas',5:'Gonzalitos|González|Gonzalez',6:'Morones Prieto',7:'Nogalar',8:'Alemán|Aleman|Aeropuerto',9:'Pablo Livas',10:'Juárez|Juarez',11:'Ru[ií]z Cort[ií]nes',12:'Lincoln',13:'Uresti|Félix|Felix',14:'Madero'};
const mem=new Map(),pending=new Map(),expire=7*24*3600*1000;
function store(id,data){if(data?.lines?.length){mem.set(+id,data);try{localStorage.setItem('veo_route_osm_'+id,JSON.stringify({ts:Date.now(),data}))}catch(_){}}return data}
function cached(id){if(mem.has(+id))return mem.get(+id);try{const raw=JSON.parse(localStorage.getItem('veo_route_osm_'+id)||'null');if(raw?.data?.lines?.length){const item={...raw.data,status:Date.now()-raw.ts>expire?'cached':raw.data.status};mem.set(+id,item);return item}}catch(_){}return null}
function coordsFromOSM(id,payload){const named=window.VEOCorridorGeo?.fold||((v)=>String(v||'').toLowerCase());const aliases=window.VEOCorridorGeo?.aliases?.[id]||[];const lines=[];
 for(const way of payload?.elements||[]){if(way.type!=='way'||!(way.geometry?.length>1))continue;
  const names=['name','name:es','alt_name','official_name','short_name','loc_name'].map(k=>way.tags?.[k]).filter(Boolean);
  if(!names.some(n=>aliases.some(a=>named(n).includes(named(a)))))continue;
  const points=way.geometry.map(p=>[+p.lat,+p.lon]).filter(p=>p.every(Number.isFinite));if(points.length>1)lines.push(points);
 }
 return lines;
}
async function direct(id){const bbox=B[id];const pattern=P[id];if(!bbox||!pattern)throw Error('Corredor inválido');
 const q=`[out:json][timeout:22];way["highway"]["name"~"${pattern}",i](${bbox.join(',')});out tags geom;`;
 const origins=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
 for(const base of origins){const controller=new AbortController();const tid=setTimeout(()=>controller.abort(),18000);
  try{const resp=await fetch(base+'?data='+encodeURIComponent(q),{signal:controller.signal,headers:{Accept:'application/json'}});if(!resp.ok)throw Error('HTTP '+resp.status);
   const payload=await resp.json();const lines=coordsFromOSM(id,payload);if(lines.length)return {status:'verified',lines,source:'OpenStreetMap / Overpass',message:'Trazado vial identificado por nombre (OpenStreetMap).'};
  }catch(_){}finally{clearTimeout(tid)}
 }
 return {status:'unavailable',lines:[],message:'No se pudo obtener el trazado vial. No se mostrará ninguna línea aproximada como si fuera real.'};
}
// Trazados OSM empaquetados con la app (instantáneos y sin depender de Overpass)
let staticData=null;
function loadStatic(){if(!staticData)staticData=fetch('/assets/corredores-trazos.json?v=20261116-ruiz-cortines',{credentials:'same-origin'}).then(r=>r.ok?r.json():null).catch(()=>null);return staticData}
async function load(id,{demo=false}={}){id=+id;if(!B[id])return {status:'invalid',lines:[],message:'Corredor inválido.'};
 const st=await loadStatic();const sl=st?.corridors?.[id];
 if(sl?.length){const r={status:'verified',lines:sl,source:'OpenStreetMap (empaquetado)',message:'Trazado vial de OpenStreetMap.'};mem.set(id,r);return r}
 const c=cached(id);if(c?.status==='verified')return c;
 if(pending.has(id))return pending.get(id);
 const task=(async()=>{let r;try{if(demo)r=await direct(id);else{const response=await fetch('/api/geo/corridor-shape/'+id,{credentials:'same-origin'});if(!response.ok)throw Error('HTTP '+response.status);r=await response.json()}}catch(_){r={status:'unavailable',lines:[],message:'La fuente de trazados no respondió.'}}
  if(r.lines?.length)return store(id,r);
  return c?{...c,status:'cached',message:'Se muestra el último trazado OSM guardado. No se pudo actualizar.'}:r;
 })();pending.set(id,task);try{return await task}finally{pending.delete(id)}}
window.VEORoutes={load,cached,BOUNDS:B};
})();

