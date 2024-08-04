import socket
import struct
import time
import json
from pywebostv.connection import WebOSClient
from pywebostv.controls import ApplicationControl
import os
import sys

STORE_PATH = 'lgtv_store.json'
TV_MAC = os.getenv('LGTV_MAC')  # Get MAC address from environment variable
TV_IP = os.getenv('LGTV_IP')    # Get IP address from environment variable

def send_wol(mac_address):
    try:
        mac_address = mac_address.replace(':', '').replace('-', '')
        if len(mac_address) != 12:
            raise ValueError("Invalid MAC address format")
        data = bytes.fromhex('FF' * 6 + mac_address * 16)
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.sendto(data, ('<broadcast>', 9))
        print("Wake-on-LAN magic packet sent successfully.")
    except Exception as e:
        print(f"Failed to send Wake-on-LAN magic packet: {e}")

def load_store():
    try:
        with open(STORE_PATH, 'r') as file:
            return json.load(file)
    except FileNotFoundError:
        return {}

def save_store(store):
    with open(STORE_PATH, 'w') as file:
        json.dump(store, file)

def connect_to_tv():
    store = load_store()
    client = WebOSClient(TV_IP)
    
    while True:
        try:
            client.connect()
            for status in client.register(store):
                if status == WebOSClient.PROMPTED:
                    print("Please accept the connection on the TV.")
                elif status == WebOSClient.REGISTERED:
                    print("Registration successful!")
                    save_store(store)
                    return client
        except Exception as e:
            print(f"Failed to connect to the TV: {e}. Retrying in 3 seconds...")
            time.sleep(3)

def launch_app(client, app_name):
    app_control = ApplicationControl(client)
    apps = app_control.list_apps()
    target_app = next((app for app in apps if app_name.lower() in app["title"].lower()), None)
    
    if target_app:
        app_control.launch(target_app)
        print(f"{app_name} app launched successfully.")
    else:
        print(f"{app_name} app not found.")

def main(app_name='plex'):
    if not TV_MAC or not TV_IP:
        print("Please set the LGTV_MAC and LGTV_IP environment variables.")
        return
    
    send_wol(TV_MAC)
    client = connect_to_tv()
    if client:
        launch_app(client, app_name)

if __name__ == "__main__":
    app_to_launch = sys.argv[1] if len(sys.argv) > 1 else 'plex'
    main(app_to_launch)
