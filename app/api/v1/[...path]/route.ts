import { handleAccountRequest } from '../../../../lib/server/account-runtime';
import { handleClassroomRequest } from '../../../../lib/server/classroom-runtime';
import { isClassroomApi } from '../../../../lib/server/classroom-http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const handle=(request:Request)=>isClassroomApi(new URL(request.url).pathname)?handleClassroomRequest(request):handleAccountRequest(request);
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
