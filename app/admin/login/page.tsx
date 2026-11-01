import {AdminLogin} from '../../../components/admin/admin-login';
import '../../../components/product/product.css';
import {requireAdminHost} from '../../../lib/server/admin-guard';
export const metadata={title:'管理后台登录 · Teeko'};
export const dynamic='force-dynamic';
export default async function AdminLoginPage(){await requireAdminHost();return <AdminLogin/>;}
