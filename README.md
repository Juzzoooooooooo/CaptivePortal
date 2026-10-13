# Ilaya National High School network portal

This project turns the captive portal and monitoring parts of `Capstone2ProJ.pdf` into two separate interfaces:

- `portal/` is an **OPNsense captive portal template** for students, teachers, and staff.
- `admin/` is a **read-only IT dashboard** for interface traffic, active captive portal sessions, the proposed network path, and optional Zabbix device health and alerts.

## Preview locally

From this folder, run these commands in separate terminals:

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory portal
node admin/server.js
```

Open `http://127.0.0.1:8765/` for the student portal and `http://127.0.0.1:8766/` for the IT dashboard. The dashboard uses **clearly labeled demo data** until OPNsense is configured. The student page is a visual preview only; a local web server cannot authorize Wi-Fi devices.

## Deploy the no-credentials captive portal

1. In **Services → Captive Portal → Administration** on OPNsense, create a zone for the school Wi-Fi interface or VLAN.
2. Leave **Authenticate using** empty if users should connect without a username or password. The page detects OPNsense's `authType: none` response and shows **Accept & connect** after the Wi-Fi guidelines checkbox is selected. It submits empty credentials to OPNsense's built-in logon API. If an authentication server is configured instead, the page shows the username and password form.
3. In the **Templates** tab, upload `ilaya-captive-portal.zip`, select it as the zone's **Custom template**, save, and apply.
4. Have the school approve or replace the draft Wi-Fi guidelines in `portal/index.html` before real use.
5. Test with a device on the protected Wi-Fi. Confirm that accepting the guidelines grants access and **Disconnect this device** ends the session.

The student portal does not hold usernames, passwords, or firewall API keys. OPNsense remains responsible for traffic interception and authorization.

## Connect the IT dashboard to live monitoring

The dashboard server uses only built-in Node.js modules. Set these environment variables in the server process:

| Variable | Purpose |
| --- | --- |
| `OPNSENSE_URL` | HTTPS URL of the OPNsense firewall, such as `https://firewall.school.local` |
| `OPNSENSE_KEY` / `OPNSENSE_SECRET` | OPNsense API key pair with read access to traffic and captive portal sessions |
| `OPNSENSE_INTERFACE` | Interface to chart, default `wan` |
| `OPNSENSE_ZONE` | Captive portal zone ID, default `0` |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Required credentials for opening the dashboard in live mode |
| `ZABBIX_URL` / `ZABBIX_TOKEN` | Optional Zabbix JSON-RPC endpoint and API token for monitored hosts and unresolved alerts |
| `ADMIN_PORT` | Local dashboard port, default `8766` |

Start with `node admin/server.js`. Live mode requires the OPNsense URL, key, and secret together, plus the dashboard admin credentials. Zabbix is optional. Keep API keys out of Git and browser code. The dashboard binds to `127.0.0.1`; for use on other devices, put it behind an authenticated HTTPS reverse proxy on the school network.

The dashboard reads OPNsense interface byte counters and calculates inbound and outbound rates between polls. The first live poll needs a second sample before it can show a rate. Session rows come from the configured captive portal zone. Zabbix hosts and problems appear only when its API is configured. The network path card depicts the proposed topology in the PDF and does not claim to discover physical links.

## Verification and limits

The local preview and demo API can be checked without school infrastructure. Real authentication, bandwidth figures, and alerts need testing against the actual OPNsense and Zabbix installations. The PDF is a proposed design; this project does not configure the firewall, VLANs, access points, or Zabbix server.

References: [OPNsense Captive Portal](https://docs.opnsense.org/manual/captiveportal.html), [OPNsense template guide](https://docs.opnsense.org/manual/how-tos/guestnet.html), [OPNsense Captive Portal API](https://docs.opnsense.org/development/api/core/captiveportal.html), [OPNsense Diagnostics API](https://docs.opnsense.org/development/api/core/diagnostics.html), [Zabbix API](https://www.zabbix.com/documentation/current/en/manual/api).
