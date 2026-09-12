import { pageTitle } from '@/lib/title';
import { SettingsView } from '@/components/SettingsView';

export const metadata = { title: pageTitle('Settings') };

export default function SettingsPage() {
  return <SettingsView />;
}
