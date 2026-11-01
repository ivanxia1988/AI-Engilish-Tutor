import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {migrateAccounts} from './migrate-accounts.mjs';
import {initializeTeacherAgents} from '../lib/server/admin-service';
import {AdminAuthService} from '../lib/server/admin-auth';
import {ModelCredentialsService} from '../lib/server/model-credentials';

export async function prepareProduction(environment:Record<string,string|undefined>=process.env){
 if(!environment.DATABASE_URL||!environment.AUTH_SECRET)throw new Error('Production configuration is incomplete.');
 await migrateAccounts(environment.DATABASE_URL);
 const pool=new Pool({connectionString:environment.DATABASE_URL,max:2});
 try{
  await initializeTeacherAgents(pool);
  const username=(environment.ADMIN_USERNAME??'admin').trim().toLowerCase();
  const existing=(await pool.query('SELECT account_id FROM teeko_admin_credentials WHERE username=$1',[username])).rows[0];
  let accountId:string,initializedAdmin=false;
  if(existing)accountId=existing.account_id;
  else{
   if(!environment.ADMIN_BOOTSTRAP_PASSWORD)throw new Error('An initial administrator must be provisioned privately.');
   const user=await new AdminAuthService(pool,{secret:environment.AUTH_SECRET}).provision(username,environment.ADMIN_BOOTSTRAP_PASSWORD);
   accountId=user.accountId;initializedAdmin=true;
  }
  const credentials=new ModelCredentialsService(pool,{secret:environment.AUTH_SECRET,environment:name=>environment[name]});
  const importedModels=await credentials.importDefaults(accountId);
  return{initializedAdmin,importedModels};
 }finally{await pool.end();}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 try{const result=await prepareProduction();console.log(`Production prepared. Administrator initialized: ${result.initializedAdmin}. Default model credentials imported: ${result.importedModels}.`);}
 catch{console.error('Production preparation failed. Check database, stable protection secret and private administrator bootstrap configuration.');process.exitCode=1;}
}
