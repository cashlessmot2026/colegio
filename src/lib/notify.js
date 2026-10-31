// Notificaciones del sistema (push local vía Service Worker) a partir de eventos en tiempo real
export async function askNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

export async function systemNotify(title, body, tag) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body, tag, icon: import.meta.env.BASE_URL + 'icons/icon-192.png', badge: import.meta.env.BASE_URL + 'icons/icon-192.png', vibrate: [120, 60, 120] };
    if (reg) reg.showNotification(title, opts); else new Notification(title, opts);
  } catch { /* el navegador puede bloquearlo */ }
}
