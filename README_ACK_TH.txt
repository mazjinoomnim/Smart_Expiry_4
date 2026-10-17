SmartExpiry V4 - Acknowledge + M5 4h

1) สำรองโปรเจกต์เดิมก่อน
2) Cloudflare D1 -> Console -> รัน ACKNOWLEDGE_TABLE.sql เพียงครั้งเดียว
3) Cloudflare Workers -> smart-expiry-device-api -> Deploy worker.js ใหม่ (รักษา Secrets และ DB binding เดิม)
4) GitHub Pages -> อัปโหลด app.js, style.css, firebase-messaging-sw.js ทับไฟล์เดิม
5) M5 UIFlow2 -> ใช้ m5_pair_alert_ack_4h.py เป็นแนวทาง โดยกรอก WiFi และ WORKER_URL ในเครื่องเท่านั้น
   สำคัญ: ใช้ไฟล์ device_secret.txt เดิม ห้ามลบ ห้าม reset/จับคู่ใหม่
6) เปิดเว็บด้วยบัญชีเดิม เพิ่มสินค้าที่หมดอายุ ทดสอบ Acknowledge แล้วตรวจ M5 หลัง polling ~60 วินาที

เงื่อนไข: M5 ส่งเสียง 3 ครั้งต่อรอบ ทุก 4 ชั่วโมงสำหรับสินค้าที่ daysLeft<=0 และยังไม่รับทราบ; สินค้าใกล้หมดอายุยังเตือนเมื่อพบครั้งแรก; การลบสินค้าจะหยุดเสียงหลังซิงก์. ปิดจอไม่ใช่ปิดเครื่อง. การนับ 4 ชั่วโมงอยู่ใน RAM (รีสตาร์ตเครื่องเริ่มนับใหม่).

สำคัญ: ถ้าเว็บแสดง No devices paired yet ระบบจะยังไม่ส่งรายการใหม่ไป M5 ต้องตรวจ owner_uid/การซิงก์ก่อน. ไม่แก้หรือรีเซ็ตการจับคู่โดยพลการ.

หมายเหตุ: ปุ่ม Acknowledge อยู่ในหน้า My Products; การแตะ push เปิดหน้า Expired ไม่ใช่ปุ่ม action บนการแจ้งเตือน iOS โดยตรง. สินค้า Expired ยังแดงเหมือนเดิมหลังรับทราบ.
