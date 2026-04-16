import { ADMIN_TABS, type AdminTabId } from '../types';

export function isAdminTab(value: string | undefined): value is AdminTabId {
  return ADMIN_TABS.some((tab) => tab.id === value);
}

export function openLegacyArea(tabId: AdminTabId): void {
  localStorage.setItem('area_tab', tabId);
  window.location.href = `/legacy-area?tab=${encodeURIComponent(tabId)}`;
}
