SmartExpiry V4 QR preview fix
1. Back up the current GitHub version.
2. Upload ONLY app.js and index.html to Smart_Expiry_4.
3. Camera scans QR link, opens product details, and requires Add to My Products confirmation.
4. Old Firestore products remain unchanged; known catalog products are restored in UI even if legacy records have incomplete fields.
5. If previously saved products are truly deleted from Firestore, this code cannot restore deleted records. Check the same Google account and Firestore backups.
6. Do not overwrite firebase-config.js, push-config.js, Worker, or M5 code.
