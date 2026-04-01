import json
import queue
import threading
import time
from dataclasses import dataclass
from pathlib import Path
import tkinter as tk
from tkinter import ttk, messagebox

import paho.mqtt.client as mqtt
import yaml

CONFIG_PATH = Path(__file__).with_name("config.yaml")
TOPIC_STATE = "zigbee2mqtt/ID Lock 150"
TOPIC_GET = "zigbee2mqtt/ID Lock 150/get"
TOPIC_SET = "zigbee2mqtt/ID Lock 150/set"
MAX_USERS = 25
READ_ONLY_USER = 108
POLL_DELAY_SECONDS = 3


@dataclass
class BrokerConfig:
    host: str
    port: int
    username: str | None
    password: str | None
    client_id: str | None


def load_config(path: Path) -> BrokerConfig:
    if not path.exists():
        raise FileNotFoundError(f"Missing config file: {path}")

    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    mqtt_cfg = data.get("mqtt")
    if not isinstance(mqtt_cfg, dict):
        raise ValueError("config.yaml must contain an 'mqtt' section")

    host = str(mqtt_cfg.get("host", "")).strip()
    if not host:
        raise ValueError("mqtt.host is required")

    return BrokerConfig(
        host=host,
        port=int(mqtt_cfg.get("port", 1883)),
        username=(str(mqtt_cfg["username"]).strip() if mqtt_cfg.get("username") is not None else None),
        password=(str(mqtt_cfg["password"]) if mqtt_cfg.get("password") is not None else None),
        client_id=(str(mqtt_cfg["client_id"]).strip() if mqtt_cfg.get("client_id") else None),
    )


def decode_pin_code(pin_obj: object) -> str:
    if not isinstance(pin_obj, dict) or not pin_obj:
        return ""

    digits: list[str] = []
    for key in sorted(pin_obj.keys(), key=lambda x: int(x)):
        value = pin_obj.get(key)
        if isinstance(value, int):
            try:
                digits.append(chr(value))
            except ValueError:
                return ""
        else:
            return ""
    return "".join(digits)


class App:
    def __init__(self, root: tk.Tk, cfg: BrokerConfig) -> None:
        self.root = root
        self.cfg = cfg
        self.event_queue: queue.Queue[tuple[str, object]] = queue.Queue()
        self.poll_started = False
        self.poll_active = False
        self.manual_pending: set[int] = set()

        self.vars: dict[int, tk.StringVar] = {}
        self.status_var = tk.StringVar(value="Ferdig")

        self._build_ui()

        self.client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=cfg.client_id or "",
            protocol=mqtt.MQTTv311,
        )
        if cfg.username:
            self.client.username_pw_set(cfg.username, cfg.password)

        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.on_disconnect = self._on_disconnect

        self.client.connect_async(cfg.host, cfg.port, keepalive=60)
        self.client.loop_start()

        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.after(150, self._drain_events)

    def _build_ui(self) -> None:
        self.root.title("ID Lock 150 PIN Manager")
        self.root.geometry("760x760")
        self.root.configure(bg="#13161a")

        style = ttk.Style()
        style.theme_use("clam")

        style.configure("Dark.TFrame", background="#13161a")
        style.configure("Dark.TLabel", background="#13161a", foreground="#e8edf2", font=("Segoe UI", 10))
        style.configure("Header.TLabel", background="#13161a", foreground="#f4f6f8", font=("Segoe UI", 14, "bold"))
        style.configure("Dark.TEntry", fieldbackground="#1f242b", foreground="#ffffff", insertcolor="#ffffff")
        style.map("Dark.TEntry", fieldbackground=[("readonly", "#1f242b")])
        style.configure(
            "Action.TButton",
            background="#2f6fed",
            foreground="#ffffff",
            borderwidth=0,
            padding=(12, 6),
            font=("Segoe UI", 9, "bold"),
        )
        style.map(
            "Action.TButton",
            background=[("active", "#3f7cff"), ("disabled", "#4c5562")],
            foreground=[("disabled", "#d3d8de")],
        )

        container = ttk.Frame(self.root, style="Dark.TFrame", padding=14)
        container.pack(fill="both", expand=True)

        header = ttk.Label(container, text="ID Lock 150 PIN koder", style="Header.TLabel")
        header.pack(anchor="w", pady=(0, 10))

        status = ttk.Label(container, textvariable=self.status_var, style="Dark.TLabel")
        status.pack(fill="x", pady=(0, 10))
        status.configure(anchor="center", justify="center")

        canvas = tk.Canvas(container, bg="#13161a", highlightthickness=0)
        scrollbar = ttk.Scrollbar(container, orient="vertical", command=canvas.yview)
        body = ttk.Frame(canvas, style="Dark.TFrame")

        body.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all")),
        )

        canvas_window = canvas.create_window((0, 0), window=body, anchor="nw")

        def resize_body(event: tk.Event) -> None:
            canvas.itemconfig(canvas_window, width=event.width)

        canvas.bind("<Configure>", resize_body)
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        for user in range(1, MAX_USERS + 1):
            row = ttk.Frame(body, style="Dark.TFrame")
            row.pack(fill="x", pady=4)

            label = ttk.Label(row, text=f"User {user}", style="Dark.TLabel", width=10)
            label.pack(side="left")

            var = tk.StringVar(value="")
            self.vars[user] = var

            entry = ttk.Entry(row, textvariable=var, style="Dark.TEntry", width=34)
            entry.pack(side="left", padx=(8, 12), fill="x", expand=True)

            actions = ttk.Frame(row, style="Dark.TFrame")
            actions.pack(side="right")

            get_btn = ttk.Button(
                actions,
                text="Les",
                style="Action.TButton",
                command=lambda u=user: self._get_user(u),
            )
            get_btn.pack(side="left")

            apply_btn = ttk.Button(
                actions,
                text="Send",
                style="Action.TButton",
                command=lambda u=user: self._apply_user(u),
            )
            apply_btn.pack(side="left", padx=(8, 0))

            delete_btn = ttk.Button(
                actions,
                text="Slett",
                style="Action.TButton",
                command=lambda u=user: self._delete_user(u),
            )
            delete_btn.pack(side="left", padx=(8, 0))

        user_108_row = ttk.Frame(body, style="Dark.TFrame")
        user_108_row.pack(fill="x", pady=(10, 4))

        label_108 = ttk.Label(user_108_row, text=f"User {READ_ONLY_USER}", style="Dark.TLabel", width=10)
        label_108.pack(side="left")

        var_108 = tk.StringVar(value="")
        self.vars[READ_ONLY_USER] = var_108
        entry_108 = ttk.Entry(
            user_108_row,
            textvariable=var_108,
            style="Dark.TEntry",
            width=34,
            state="readonly",
        )
        entry_108.pack(side="left", padx=(8, 12), fill="x", expand=True)

    def _on_connect(self, client: mqtt.Client, _userdata, flags, reason_code, _properties) -> None:
        if reason_code == 0:
            client.subscribe(TOPIC_STATE, qos=0)
            if not self.poll_started:
                self.poll_started = True
                threading.Thread(target=self._poll_users, daemon=True).start()
        else:
            self.event_queue.put(("status", "Ferdig"))

    def _on_disconnect(self, _client: mqtt.Client, _userdata, _flags, reason_code, _properties) -> None:
        self.event_queue.put(("status", "Ferdig"))

    def _request_user(self, user: int) -> None:
        payload = {"pin_code": {"user": user}}
        self.client.publish(TOPIC_GET, json.dumps(payload), qos=0, retain=False)

    def _poll_users(self) -> None:
        self.poll_active = True
        for user in [*range(1, MAX_USERS + 1), READ_ONLY_USER]:
            self.event_queue.put(("status", f"Leser bruker {user}"))
            self._request_user(user)
            time.sleep(POLL_DELAY_SECONDS)
        self.poll_active = False
        if not self.manual_pending:
            self.event_queue.put(("status", "Ferdig"))

    def _on_message(self, _client: mqtt.Client, _userdata, msg: mqtt.MQTTMessage) -> None:
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
        except Exception:
            return

        users = payload.get("users") if isinstance(payload, dict) else None
        if not isinstance(users, dict):
            return

        updates: dict[int, str] = {}
        for user_key, user_data in users.items():
            try:
                user_no = int(user_key)
            except (TypeError, ValueError):
                continue
            if user_no not in self.vars:
                continue
            if not isinstance(user_data, dict):
                continue

            if user_data.get("status") == "available":
                pin = ""
            else:
                pin = decode_pin_code(user_data.get("pin_code"))
            updates[user_no] = pin

        if updates:
            self.event_queue.put(("pins", updates))
            for user_no in updates:
                self.manual_pending.discard(user_no)
            if not self.poll_active and not self.manual_pending:
                self.event_queue.put(("status", "Ferdig"))

    def _apply_user(self, user: int) -> None:
        code = self.vars[user].get().strip()
        if not code.isdigit():
            messagebox.showerror("Invalid PIN", f"User {user} PIN must be numeric.")
            return
        payload = {
            "pin_code": {
                "user": user,
                "pin_code": int(code),
            }
        }

        result = self.client.publish(TOPIC_SET, json.dumps(payload), qos=0, retain=False)
        if result.rc != mqtt.MQTT_ERR_SUCCESS:
            self.status_var.set("Ferdig")

    def _get_user(self, user: int) -> None:
        self.manual_pending.add(user)
        self.status_var.set(f"Leser bruker {user}")
        self._request_user(user)

    def _delete_user(self, user: int) -> None:
        payload = {"pin_code": {"user": user}}
        result = self.client.publish(TOPIC_SET, json.dumps(payload), qos=0, retain=False)
        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            self.vars[user].set("")
            self.status_var.set("Ferdig")
        else:
            self.status_var.set("Ferdig")

    def _drain_events(self) -> None:
        while True:
            try:
                kind, data = self.event_queue.get_nowait()
            except queue.Empty:
                break

            if kind == "status":
                self.status_var.set(str(data))
            elif kind == "pins" and isinstance(data, dict):
                for user, value in data.items():
                    if user in self.vars:
                        self.vars[user].set(value)

        self.root.after(150, self._drain_events)

    def _on_close(self) -> None:
        try:
            self.client.loop_stop()
            self.client.disconnect()
        except Exception:
            pass
        self.root.destroy()


def main() -> None:
    try:
        cfg = load_config(CONFIG_PATH)
    except Exception as exc:
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("Configuration error", str(exc))
        root.destroy()
        raise SystemExit(1)

    root = tk.Tk()
    App(root, cfg)
    root.mainloop()


if __name__ == "__main__":
    main()
