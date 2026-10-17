SmartExpiry V4 Dynamic QR
อัปโหลดทับ GitHub เพียง app.js และ index.html
QR ปลาอยู่ใน Fish_QR_Test.png ไม่จำเป็นต้องอัปโหลด
สแกน QR แล้วระบบบันทึก Firestore อัตโนมัติ ไม่ต้องกรอกชื่อ/วันหมดอายุ
QR ใหม่ต้องเป็น JSON ที่มี name และ exp (YYYY-MM-DD) และอาจมี mfg emoji category
QR เดิมที่เป็นรหัสสินค้าใน catalog ยังคงใช้ได้
ห้ามอัปโหลด worker.js หรือ push-config.js ทับค่าที่ตั้งไว้
หมายเหตุ: ต้องล็อกอินและมีสิทธิ์เขียน Firestore; ระบบ M5 ต้อง sync ตามปกติ
