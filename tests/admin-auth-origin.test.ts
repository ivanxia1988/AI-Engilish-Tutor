import test from 'node:test';
import assert from 'node:assert/strict';
import {adminOrigin} from '../lib/server/admin-origin';
import {withRuntimeEnv} from '../lib/server/runtime-env';
test('admin origin accepts dedicated HTTPS or local origins and rejects paths or userinfo',()=>{
 assert.equal(withRuntimeEnv({ADMIN_ORIGIN:'https://admin.teeko.app'},adminOrigin),'https://admin.teeko.app');
 assert.equal(withRuntimeEnv({ADMIN_ORIGIN:'http://127.0.0.1:8080'},adminOrigin),'http://127.0.0.1:8080');
 for(const value of ['http://admin.teeko.app','https://admin.teeko.app/path','https://user@admin.teeko.app','https://admin.teeko.app/'])assert.throws(()=>withRuntimeEnv({ADMIN_ORIGIN:value},adminOrigin));
});
