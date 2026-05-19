import { redirect } from 'next/navigation';

export default function AdminRoot() {
  redirect('/platform-admin/dashboard');
}
