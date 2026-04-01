# ID Lock 150 PIN Manager

Liten Python-skrivebordsapp som kobler seg til MQTT, leser brukere 1-25 fra `zigbee2mqtt/ID Lock 150`, og lar deg oppdatere én PIN-kode om gangen.

## Oppsett

1. Rediger `config.yaml` med broker-vert og innloggingsdetaljer.
2. Installer avhengigheter:

```powershell
python -m pip install -r requirements.txt
```

3. Kjør:

```powershell
python app.py
```

## Oppførsel

- Abonnerer på `zigbee2mqtt/ID Lock 150`
- Leser bruker-PIN ved å publisere til `zigbee2mqtt/ID Lock 150/get` med:
  - `{"pin_code":{"user":1}}` ... `{"pin_code":{"user":25}}`
- Venter 3 sekunder mellom hver publisering.
- Dekoder ASCII-PIN-data i `users.*.pin_code` og viser klartekst.
- Send-knappen publiserer til `zigbee2mqtt/ID Lock 150/set` med:
  - `{"pin_code":{"user":<n>,"pin_code":"<value>"}}`

## Notater

- Hvis en bruker ikke har PIN-kode, forblir feltet tomt.
- Grensesnittet bruker mørkt tema.
