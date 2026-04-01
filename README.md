# ID Lock 150 PIN Manager

Small Python desktop app that connects to MQTT, reads users 1-25 from `zigbee2mqtt/ID Lock 150`, and lets you update one PIN at a time.

## Setup

1. Edit `config.yaml` with your broker host/credentials.
2. Install dependencies:

```powershell
python -m pip install -r requirements.txt
```

3. Run:

```powershell
python app.py
```

## Behavior

- Subscribes to `zigbee2mqtt/ID Lock 150`
- Reads user PINs by publishing to `zigbee2mqtt/ID Lock 150/get` with:
  - `{"pin_code":{"user":1}}` ... `{"pin_code":{"user":25}}`
- Waits 3 seconds between each publish.
- Decodes ASCII pin data in `users.*.pin_code` and shows clear text.
- Apply button publishes to `zigbee2mqtt/ID Lock 150/set` with:
  - `{"pin_code":{"user":<n>,"pin_code":"<value>"}}`

## Notes

- If a user has no pin code, the field stays empty.
- UI uses a dark theme.
