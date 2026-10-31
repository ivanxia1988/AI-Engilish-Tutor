import { AccountForm } from '../../components/product/account-form';
import { accountIntent } from '../../components/product/account-state';
import '../../components/product/product.css';

export const metadata = { title: '登录 · Teeko' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ intent?: string | string[] }> }) {
  const query = await searchParams;
  const intent = accountIntent(typeof query.intent === 'string' ? query.intent : undefined);
  return <AccountForm key={intent} intent={intent} />;
}
