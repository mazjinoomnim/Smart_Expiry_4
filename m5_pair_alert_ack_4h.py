# UIFlow 2.0 - M5StickC Plus2
# Configure these locally. Never share your Wi-Fi password or device secret.
import M5
import network
import time
import os
import ujson
import urequests

WIFI_NAME = 'YOUR_WIFI_NAME'
WIFI_PASSWORD = 'YOUR_WIFI_PASSWORD'
WORKER_URL = 'https://smart-expiry-device-api.manatsawee-a.workers.dev'

M5.begin()
M5.Lcd.fillScreen(0x101820)
M5.Lcd.setTextColor(0xFFFFFF)
M5.Lcd.setTextSize(2)
M5.Lcd.drawString('SmartExpiry', 10, 12)

wifi = network.WLAN(network.STA_IF)
wifi.active(True)
if not wifi.isconnected():
    wifi.connect(WIFI_NAME, WIFI_PASSWORD)
    for _ in range(25):
        if wifi.isconnected():
            break
        time.sleep(1)
if not wifi.isconnected():
    M5.Lcd.drawString('WiFi ERROR', 10, 75)
    raise RuntimeError('WiFi not connected')

mac = wifi.config('mac')
device_id = 'M5-' + ''.join('%02X' % b for b in mac[-3:])
try:
    with open('device_secret.txt', 'r') as f:
        secret = f.read().strip()
except OSError:
    secret = ''.join('%02x' % b for b in os.urandom(32))
    with open('device_secret.txt', 'w') as f:
        f.write(secret)

def call(path, payload=None):
    headers = {'X-Device-ID': device_id, 'X-Device-Secret': secret}
    if payload is None:
        r = urequests.get(WORKER_URL + path, headers=headers)
    else:
        headers['Content-Type'] = 'application/json'
        r = urequests.post(WORKER_URL + path, headers=headers, data=ujson.dumps(payload))
    try:
        data = r.json()
        if r.status_code >= 400:
            raise RuntimeError(str(data))
        return data
    finally:
        r.close()

def screen(title, line1='', line2='', color=0xFFFFFF):
    M5.Lcd.fillScreen(0x101820)
    M5.Lcd.setTextSize(2)
    M5.Lcd.setTextColor(0x00FF88)
    M5.Lcd.drawString('SmartExpiry', 8, 8)
    M5.Lcd.setTextSize(1)
    M5.Lcd.setTextColor(color)
    M5.Lcd.drawString(str(title)[:27], 8, 52)
    M5.Lcd.setTextColor(0xFFFFFF)
    M5.Lcd.drawString(str(line1)[:34], 8, 80)
    M5.Lcd.drawString(str(line2)[:34], 8, 105)

# Sound: firmware support varies; test Speaker.tone on this UIFlow version.
def beep(frequency=1400, duration=160):
    try:
        M5.Speaker.tone(frequency, duration)
    except Exception as e:
        print('Speaker unavailable:', e)

def alert_sound(days):
    # Expiring today / expired: 3 distinct tones per reminder round.
    if days <= 0:
        for _ in range(3):
            beep(1600 if days == 0 else 1100, 230)
            time.sleep_ms(380)
    else:
        for _ in range(2):
            beep(1500, 150)
            time.sleep_ms(300)

screen('Connecting...', device_id)
response = call('/device/alerts')
if not response.get('paired'):
    screen('NOT PAIRED', device_id)
    raise RuntimeError('Device is not paired')
screen('DEVICE CONNECTED', device_id, 'SmartExpiry Ready', 0x00FF88)
time.sleep(2)

# Check every 60 seconds. Repeat overdue/today warnings every 4 hours.
# This timer is kept in RAM: restarting M5 starts a new reminder cycle.
FOUR_HOURS_MS = 4 * 60 * 60 * 1000
last_urgent_alert = {}  # product name -> ticks_ms at last reminder
previous_soon = set()
while True:
    try:
        result = call('/device/alerts')
        if not result.get('paired'):
            screen('NOT PAIRED', device_id)
            time.sleep(60)
            continue
        alerts = result.get('alerts', [])
        if not alerts:
            screen('ALL CLEAR', 'No expiry alerts', 'Check again in 60 sec', 0x00FF88)
        else:
            current_soon = set()
            urgent_names = set()
            for item in alerts:
                days = int(item['daysLeft'])
                name = str(item['name'])
                product_key = str(item.get('id', name)) + '|' + str(item.get('exp', ''))
                acknowledged = bool(item.get('acknowledged', False))
                status = 'EXPIRED' if days < 0 else ('EXPIRES TODAY' if days == 0 else 'EXPIRING SOON')
                color = 0xFF4444 if days <= 0 else 0xFFCC00
                screen(status, name, 'Days left: ' + str(days), color)
                if days <= 0:
                    if acknowledged:
                        screen('ACKNOWLEDGED', name, 'No repeat sound', 0x00FF88)
                        continue
                    urgent_names.add(product_key)
                    now = time.ticks_ms()
                    last = last_urgent_alert.get(product_key)
                    if last is None or time.ticks_diff(now, last) >= FOUR_HOURS_MS:
                        alert_sound(days)
                        last_urgent_alert[product_key] = time.ticks_ms()
                else:
                    key = name + '|' + str(days)
                    current_soon.add(key)
                    if key not in previous_soon:
                        alert_sound(days)
                time.sleep(3)
            previous_soon = current_soon
            for name in list(last_urgent_alert):
                if name not in urgent_names:
                    del last_urgent_alert[name]
    except Exception as e:
        print('Fetch failed:', e)
        screen('CONNECTION ERROR', str(e)[:30])
    time.sleep(60)
