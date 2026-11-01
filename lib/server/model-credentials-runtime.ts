import {getAccountPool} from '../../db/postgres';
import {ModelCredentialsService} from './model-credentials';
import {readRuntimeEnv} from './runtime-env';
import {createTeacherCredentialRoutes} from './teacher-credential-routing';
export function getModelCredentialsService(){return new ModelCredentialsService(getAccountPool(readRuntimeEnv('DATABASE_URL')),{secret:readRuntimeEnv('AUTH_SECRET')??'',environment:readRuntimeEnv});}
export function getTeacherCredentialRoutes(){return createTeacherCredentialRoutes(model=>getModelCredentialsService().resolve(model),readRuntimeEnv);}
