// Firebase Messaging service worker. Served from the GitHub Pages project root.
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
firebase.initializeApp({
 apiKey:'AIzaSyAVGO7QKEZuWBnLtlggVdj1kOarBJej7BI',
 authDomain:'smart-expiry-20a38.firebaseapp.com',
 projectId:'smart-expiry-20a38',
 messagingSenderId:'285944949362',
 appId:'1:285944949362:web:b1b59b6fc4f30474c4b0eb'
});
const messaging=firebase.messaging();
messaging.onBackgroundMessage(payload=>{
 // FCM HTTP v1 sends a data-only payload; show exactly one notification here.
 const data=payload.data||{};
 self.registration.showNotification(data.title||'SmartExpiry',{body:data.body||'Check your products',icon:'./icon-192.png',badge:'./icon-192.png',tag:data.tag||'smart-expiry',data:{url:'./?ack=1'}});
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil(clients.openWindow(new URL(event.notification.data?.url||'./?ack=1',self.registration.scope).href));
});
