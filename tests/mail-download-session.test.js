import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionBoundary } from '../src/middlewares/session.middleware.js';
test('only exact public mail download GET/POST bypass stale browser session',async()=>{
 let checked=0,next=0;
 const boundary=createSessionBoundary({fetchImpl:async()=>{checked++;return {status:401};}});
 const res={status(code){assert.equal(code,401);return this;},json(){}};
 for(const method of ['GET','POST']) await boundary({path:'/rrhh-api/correo/descargas',method,headers:{},cookies:{token:'expired'}},res,()=>next++);
 assert.equal(next,2);assert.equal(checked,0);
 for(const path of ['/rrhh-api/correo/descargas/other','/rrhh-api/correo/borradores']) await boundary({path,method:'POST',headers:{},cookies:{token:'expired'}},res,()=>next++);
 assert.equal(checked,2);assert.equal(next,2);
});
