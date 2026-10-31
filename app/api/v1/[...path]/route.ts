import { handleAccountRequest } from '../../../../lib/server/account-runtime';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const GET = handleAccountRequest;
export const POST = handleAccountRequest;
export const PATCH = handleAccountRequest;
