# SmartExpiry — การแจ้งเตือนโทรศัพท์แม้ปิดเว็บ

**สถานะ:** ชุดโค้ดพร้อมนำไปตั้งค่า แต่ยังไม่ได้ Deploy หรือทดสอบการส่ง Push จริงบนโทรศัพท์ของคุณ

## 1) สำรองก่อน
สำรอง `worker.js` ที่ใช้งานจริงใน Cloudflare และไฟล์เว็บไซต์บน GitHub ก่อนทุกครั้ง ห้ามเปลี่ยน `m5_pair_alert.py` หรือ secret ของ M5

## 2) Firebase Cloud Messaging
1. เข้า Firebase Console ของโปรเจกต์ `smart-expiry-20a38` → Project settings → Cloud Messaging
2. เปิดใช้ Firebase Cloud Messaging API (HTTP v1) หากยังไม่เปิด
3. หัวข้อ **Web Push certificates** → Generate key pair (ถ้ายังไม่มี) → คัดลอก **Public VAPID key**
4. ใส่ค่า Public VAPID key ลงใน `push-config.js` แทน `PASTE_FIREBASE_WEB_PUSH_PUBLIC_KEY_HERE` (คีย์นี้เป็น public)
5. ใน Firebase Console → Project settings → Service accounts → Generate new private key. **ไฟล์ JSON นี้เป็นความลับ ห้ามอัปโหลด GitHub หรือส่งให้ผู้อื่น**

## 3) Cloudflare D1
1. เปิดฐานข้อมูลเดิม `smart-expiry-devices` → Console
2. รันเฉพาะคำสั่ง `CREATE TABLE IF NOT EXISTS push_tokens`, `CREATE INDEX IF NOT EXISTS push_tokens_uid`, `CREATE TABLE IF NOT EXISTS push_products`, และ `CREATE TABLE IF NOT EXISTS push_sent` ใน `schema.sql` (หรือรัน schema.sql ทั้งไฟล์ก็ได้ เพราะใช้ IF NOT EXISTS)
3. ตารางเดิม `devices` จะไม่ถูกลบ

## 4) Cloudflare Worker
1. สำรองโค้ด Worker เดิม แล้วแทนด้วย `worker.js` ใน ZIP นี้ → Deploy
2. ตรวจว่า D1 binding `DB` และ secret `FIREBASE_WEB_API_KEY` เดิมยังอยู่
3. เพิ่ม **Secret** ชื่อ `FCM_SERVICE_ACCOUNT_JSON` โดยใส่เนื้อหา JSON จาก service-account private key ทั้งไฟล์ลงในค่า Secret **เฉพาะใน Cloudflare** ไม่ใส่ในโค้ด ไม่อัปโหลด GitHub
4. เพิ่ม Cron Trigger `0 1 * * *` (ทุกวัน 01:00 UTC = 08:00 น. ไทย) ใน Worker Settings → Triggers; Cloudflare อาจใช้เวลาสักพักกว่าจะเริ่มทำงาน
5. ทดสอบ `/health` ต้องยังได้ `{ "ok": true }`

## 5) GitHub Pages
อัปโหลดเฉพาะไฟล์เว็บเหล่านี้ไปที่ root ของ repository `Smart_ExpiryV3`:
`index.html`, `app.js`, `style.css`, `device-config.js`, `firebase-config.js`, `push-config.js`, `firebase-messaging-sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`

**อย่าอัปโหลด `worker.js`, `schema.sql`, service-account JSON หรือไฟล์ความลับใด ๆ ไป GitHub**

## 6) โทรศัพท์
- Android: เปิด SmartExpiry ใน Chrome → ลงชื่อเข้าใช้ → กด Enable phone notifications → Allow
- iPhone: ต้องเป็น iOS 16.4+ → เปิด SmartExpiry ใน Safari → Share → Add to Home Screen → เปิดผ่านไอคอนที่หน้าจอโฮม → ลงชื่อเข้าใช้ → กด Enable phone notifications → Allow
- การแจ้งเตือนอัตโนมัติจะส่งทุกวัน **08:00 น. ประเทศไทย** เมื่อสินค้ามีวันหมดอายุเหลือ 3, 2, 1, 0 วัน หรือเลยมา 1 วัน
- เมื่อเพิ่ม/ลบสินค้า ให้เปิดเว็บขณะออนไลน์สักครู่เพื่อซิงก์รายการล่าสุดเข้าสู่ Worker; จากนั้นปิดเว็บได้
- ต้องอนุญาตแจ้งเตือนและไม่บล็อกแจ้งเตือนของเบราว์เซอร์/แอปเว็บในระบบโทรศัพท์
- โปรเจกต์นี้เป็นต้นแบบ: ไม่มีหน้าปิดการรับแจ้งเตือน/ลบ token จากเซิร์ฟเวอร์ ควรเพิ่มก่อนใช้จริงในวงกว้าง โดยเฉพาะเครื่องที่ใช้ร่วมกัน

## ข้อจำกัดการทดสอบ
- การกดเปิดแจ้งเตือนวันนี้ **ไม่ได้ส่งทันที**; จะส่งในรอบ Cron ถัดไปเวลา 08:00 น. ไทย
- ต้อง Deploy ทั้ง Worker, D1 schema, และเว็บไซต์ พร้อมตั้งค่า VAPID และ service account ก่อนจึงใช้งานได้
- Worker จะส่งเฉพาะรายการที่เว็บซิงก์ให้ และไม่เปลี่ยนระบบ M5 ที่ใช้อยู่
