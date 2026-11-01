import test from 'node:test';
import assert from 'node:assert/strict';
import {modelCredentialInputSchema,modelCredentialResetSchema,modelCredentialStatusSchema} from '../lib/model-credentials';
test('model credentials require explicit provider, revision and valid bounded provider configuration',()=>{
 assert(modelCredentialInputSchema.safeParse({provider:'openai',expectedRevision:0,apiKey:'synthetic-fixture-key'}).success);
 assert(modelCredentialInputSchema.safeParse({provider:'qwen',expectedRevision:2,apiKey:'synthetic-fixture-key',workspaceId:'fixture-space',region:'cn-beijing'}).success);
 for(const input of [{provider:'qwen',expectedRevision:0,apiKey:'synthetic-fixture-key'},{provider:'openai',expectedRevision:0,apiKey:' '},{provider:'openai',expectedRevision:-1,apiKey:'synthetic-fixture-key'},{provider:'openai',expectedRevision:0,apiKey:'synthetic-fixture-key',endpoint:'https://outside.invalid'},{provider:'openai',expectedRevision:0,apiKey:'x'.repeat(1025)}])assert(!modelCredentialInputSchema.safeParse(input).success);
 assert(modelCredentialResetSchema.safeParse({provider:'openai',expectedRevision:1}).success);
});
test('credential status never accepts secret-bearing fields',()=>{
 const status={provider:'openai',source:'model',configured:true,revision:1,updatedAt:'2026-11-01T00:00:00Z'};
 assert(modelCredentialStatusSchema.safeParse(status).success);
 assert(!modelCredentialStatusSchema.safeParse({...status,apiKey:'synthetic-fixture-key'}).success);
});
