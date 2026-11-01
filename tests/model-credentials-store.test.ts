import test from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {ModelCredentialsError,ModelCredentialsService} from '../lib/server/model-credentials';

test('model credential encryption requires a stable protection secret before any database access',async()=>{
 const pool=new Pool({connectionString:'postgresql://fixture@127.0.0.1:1/fixture_test'});
 try{
  assert.throws(()=>new ModelCredentialsService(pool,{secret:'short'}),/保护密钥/);
  const service=new ModelCredentialsService(pool,{secret:'synthetic-model-protection-secret-at-least-32-bytes'});
  await assert.rejects(service.resolve({id:'invalid',provider:'openai'}),error=>error instanceof ModelCredentialsError&&error.code==='INVALID_INPUT');
 }finally{await pool.end();}
});
