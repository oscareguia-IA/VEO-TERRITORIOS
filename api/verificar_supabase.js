module.exports=async(req,res)=>{
res.setHeader('Cache-Control','no-store');
const expected='https://irmxdihpftqdcegoptmn.supabase.co';
const url=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const key=(process.env.SUPABASE_SECRET_KEY||'').trim();
const alphabet=/^[A-Za-z0-9_-]+$/;
let r={status:0};
try{const response=await fetch(expected+'/rest/v1/veo_users?select=id&limit=1',{headers:{apikey:key},signal:AbortSignal.timeout(8000)});r={status:response.status,ok:response.ok}}catch(e){r={transportError:e.name}}
const p=key.startsWith('sb_secret_');
const pos=key[32]==='_';
const payload=key.slice(10,32),check=key.slice(33);
res.status(200).json({projectMatches:url===expected,keyLength:key.length,validPrefix:p,separatorAtExpectedPosition:pos,randomSegmentUrlSafe:alphabet.test(payload),checksumSegmentUrlSafe:alphabet.test(check),hasWhitespaceInside:/\s/.test(key),keyShapeIsPlausible:p&&pos&&payload.length===22&&check.length===8&&alphabet.test(payload)&&alphabet.test(check),probe:r});
}