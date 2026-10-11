const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto');
const wire=require('./wire');
test('canonical encoding has stable object order',()=>assert.equal(wire.canonical({z:1,a:{y:2,b:3}}),wire.canonical({a:{b:3,y:2},z:1})));
test('all metadata authenticated',()=>{const k=crypto.generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});const e={id:crypto.randomUUID(),nonce:'a'.repeat(32),requires_human_approval:true};e.signature=wire.sign(e,k.privateKey);assert.equal(wire.verify(e,e.signature,k.publicKey),true);assert.equal(wire.verify({...e,requires_human_approval:false},e.signature,k.publicKey),false)});
test('approval fails closed',()=>{for(const reply of ['',null,'no thanks','not now'])assert.notEqual(wire.approvalDecision(reply),true)});
