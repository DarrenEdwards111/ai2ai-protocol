/** Hardened wire profile. Breaking change: 1.1; no legacy signature fallback. */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const VERSION = '1.1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(['message','request','response','confirm','reject','receipt','ping']);
function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  throw new Error('Non-JSON value');
}
function signedBytes(e) { const v = {...e}; delete v.signature; return Buffer.from(canonical(v)); }
function sign(e, key) { return crypto.sign(null, signedBytes(e), key).toString('base64'); }
function verify(e, signature, key) { try { const publicKey=crypto.createPublicKey(key); return publicKey.asymmetricKeyType === 'ed25519' && typeof signature === 'string' && crypto.verify(null,signedBytes(e),publicKey,Buffer.from(signature,'base64')); } catch { return false; } }
function validate(e, recipient, maxAge=86400000) {
  if (!e || Array.isArray(e) || typeof e !== 'object') return 'invalid_envelope';
  if (e.ai2ai !== VERSION) return 'unsupported_version';
  if (!UUID.test(e.id) || !UUID.test(e.conversation)) return 'invalid_identifier';
  if (!TYPES.has(e.type) || !e.from || typeof e.from.agent !== 'string' || !e.from.agent.length || e.from.agent.length>200) return 'invalid_sender_or_type';
  if (!recipient || !e.to || e.to.agent !== recipient) return 'wrong_recipient';
  if (!e.payload || typeof e.payload !== 'object' || Array.isArray(e.payload)) return 'invalid_payload';
  if (typeof e.requires_human_approval !== 'boolean') return 'invalid_approval_flag';
  if (e.type === 'request' && (typeof e.intent !== 'string' || !e.intent.length)) return 'missing_intent';
  if (typeof e.nonce !== 'string' || !/^[0-9a-f]{32}$/i.test(e.nonce)) return 'invalid_nonce';
  const iso = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
  if (!iso(e.timestamp) || !iso(e.expiresAt)) return 'invalid_timestamp';
  const now=Date.now(), t=Date.parse(e.timestamp), end=Date.parse(e.expiresAt);
  if (t>now+300000 || now-t>maxAge || end<=now || end<=t || end-t>maxAge) return 'message_expired_or_invalid_time';
  if (typeof e.signature !== 'string' || !e.signature.length) return 'missing_signature';
  return null;
}
function safePath(dir,id,suffix) { if (!UUID.test(id)) throw new Error('Invalid identifier'); return path.join(dir,id+suffix); }
function approvalDecision(reply) {
  if (typeof reply !== 'string') return null;
  const s=reply.trim().toLowerCase();
  if (['yes','approve','approved','confirm'].includes(s)) return true;
  if (['no','decline','reject','deny','no thanks','do not approve'].includes(s)) return false;
  return null;
}
// Persist reservations BEFORE dispatch. Crash leaves a pending record, never automatic re-execution.
class Inbox {
 constructor(dir) { this.dir=dir; fs.mkdirSync(dir,{recursive:true}); }
 reserve(e) {
  const file=path.join(this.dir,crypto.createHash('sha256').update(e.from.agent+'\0'+e.id).digest('hex')+'.json');
  const hash=crypto.createHash('sha256').update(signedBytes(e)).digest('hex');
  if(fs.existsSync(file)) {const old=JSON.parse(fs.readFileSync(file,'utf8')); if(old.hash!==hash) throw new Error('message_id_conflict'); return {duplicate:true,result:old.result};}
  // Scope nonce to authenticated sender; no untrusted cache poisoning.
  const nonce=path.join(this.dir,'nonce-'+crypto.createHash('sha256').update(e.from.agent+'\0'+e.nonce).digest('hex'));
  try { fs.writeFileSync(nonce,e.id,{flag:'wx',mode:0o600}); } catch(err) { if(err.code==='EEXIST') throw new Error('replay_detected'); throw err; }
  const record={hash,result:{status:'processing',id:e.id}};
  fs.writeFileSync(file,JSON.stringify(record),{flag:'wx',mode:0o600});
  return {duplicate:false,finish(result){record.result=result;const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(record),{mode:0o600});fs.renameSync(tmp,file);}};
 }
}
module.exports={VERSION,canonical,signedBytes,sign,verify,validate,safePath,approvalDecision,Inbox};
