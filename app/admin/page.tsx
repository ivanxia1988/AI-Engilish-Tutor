import {AdminConsole} from '../../components/admin/admin-console';
import '../../components/product/product.css';
import '../../components/admin/admin.css';
import {requireAdminAccount} from '../../lib/server/admin-guard';
import {accountOrigin} from '../../lib/server/account-runtime';

export const metadata={title:'管理后台 · Teeko'};
export const dynamic='force-dynamic';
export default async function AdminPage(){await requireAdminAccount();return <AdminConsole productHref={`${accountOrigin()}/courses`}/>;}
