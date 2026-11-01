import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {AdminAuthService} from '../lib/server/admin-auth';
import {initializeTeacherAgents} from '../lib/server/admin-service';

export async function provisionAdmin(environment:NodeJS.ProcessEnv=process.env){
 const username=environment.ADMIN_USERNAME??'admin',password=environment.ADMIN_PASSWORD;
 if(!environment.DATABASE_URL||!environment.AUTH_SECRET||!password)throw new Error('Administrator provisioning environment is incomplete.');
 const pool=new Pool({connectionString:environment.DATABASE_URL,max:1});
 try{await initializeTeacherAgents(pool);await new AdminAuthService(pool,{secret:environment.AUTH_SECRET}).provision(username,password);}finally{await pool.end();}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 try{if(process.argv.length!==2)throw new Error('Use environment variables.');await provisionAdmin();console.log('Administrator created or updated; old administrator sessions revoked.');}
 catch{console.error('Administrator provisioning failed. Check the private environment and migrations.');process.exitCode=1;}
}
