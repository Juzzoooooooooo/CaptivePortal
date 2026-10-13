# Network Setup Guide
## Proxmox + OPNsense + Zabbix + TP-Link VLAN Switch

> **Planning example:** The VLAN IDs, IP addresses, and switch ports below are a proposed layout. Verify them against the actual school equipment and approved network plan before applying changes.

---

## Network Diagram

```
[ISP/Modem]
     |
     | (WAN)
     |
[Proxmox Server]
  ├── OPNsense VM (WAN → ISP, LAN → vmbr1)
  ├── Zabbix VM (vmbr1)
  └── Admin Portal VM (vmbr1)
     |
     | (NIC2 - LAN trunk)
     |
[TP-Link 16-Port VLAN Switch]
  ├── VLAN 10 → Access Point (Guest WiFi + Captive Portal)
  ├── VLAN 20 → Management (Zabbix, Admin devices)
  └── VLAN 99 → Trunk port (papunta Proxmox)
```

---

## VLAN Plan

| VLAN ID | Purpose             | Subnet              |
|---------|---------------------|---------------------|
| VLAN 10 | Guest / WiFi Users  | 192.168.10.0/24     |
| VLAN 20 | Management / Admin  | 192.168.20.0/24     |
| VLAN 99 | Trunk (Proxmox uplink) | —                |

---

## IP Address Plan

| Device            | IP Address       |
|-------------------|------------------|
| OPNsense LAN      | 192.168.1.1      |
| OPNsense VLAN10   | 192.168.10.1     |
| OPNsense VLAN20   | 192.168.20.1     |
| Zabbix VM         | 192.168.20.10    |
| Admin Portal VM   | 192.168.20.20    |
| DHCP Range (Guest)| 192.168.10.100 - 192.168.10.200 |
| DHCP Range (Mgmt) | 192.168.20.100 - 192.168.20.150 |

---

## Physical Connections

```
ISP Modem
   └── [Cable] → NIC1 ng Proxmox Server (WAN)

Proxmox Server
   └── NIC2 → [Cable] → Port 1 ng TP-Link Switch (Trunk)
                            ├── Port 2-8  → Access Point (VLAN 10)
                            └── Port 9-12 → Management Devices (VLAN 20)
```

---

## 1. Proxmox Network Setup

Sa Proxmox, gumawa ng 2 Linux Bridges:

| Bridge | Purpose                                      |
|--------|----------------------------------------------|
| vmbr0  | WAN — nakaconnect sa NIC1 (papunta ISP)      |
| vmbr1  | LAN Trunk — internal network ng lahat ng VMs |

- `vmbr1` dapat **walang VLAN tag** (trunk mode) para makapasa ang lahat ng VLAN tags papunta OPNsense.

---

## 2. TP-Link VLAN Switch Configuration

### Step 1: Access the Switch
- Open the switch at its configured management address and sign in with the school's administrator account. Confirm the address and menu names for the installed switch model.

### Step 2: Create VLANs
- Go to **VLAN → 802.1Q VLAN**
- Create **VLAN 10**, **VLAN 20**, **VLAN 99**

### Step 3: Assign Ports

| Port     | Mode   | VLAN                        |
|----------|--------|-----------------------------|
| Port 1   | Trunk  | VLAN 10, 20, 99 (→ Proxmox) |
| Port 2-8 | Access | VLAN 10 (AP ports)          |
| Port 9-12| Access | VLAN 20 (Management)        |
| Port 13-16| Access | VLAN 10 or 20 (spare)      |

### Step 4: Set PVID
- VLAN 10 ports → PVID **10**
- VLAN 20 ports → PVID **20**
- Trunk port (Port 1) → PVID **99**

---

## 3. OPNsense VM Setup

### Network Interfaces sa Proxmox
- **vtnet0** → vmbr0 (WAN)
- **vtnet1** → vmbr1 (LAN trunk)

### Step 1: Create VLAN Interfaces
- Go to **Interfaces → Other Types → VLAN**

| VLAN Tag | Parent Interface | Name    |
|----------|-----------------|---------|
| 10       | vtnet1          | VLAN10  |
| 20       | vtnet1          | VLAN20  |

### Step 2: Assign and Enable Interfaces
- **Interfaces → Assignments**
- Add VLAN10 → Enable → IP: `192.168.10.1/24`
- Add VLAN20 → Enable → IP: `192.168.20.1/24`

### Step 3: DHCP per VLAN
- Go to **Services → DHCPv4**
- VLAN10 → Range: `192.168.10.100` to `192.168.10.200`
- VLAN20 → Range: `192.168.20.100` to `192.168.20.150`

### Step 4: Enable Captive Portal on VLAN10
- Go to **Services → Captive Portal**
- Click **"+"** to create a new zone
- Interface: **VLAN10**
- Leave **Authenticate using** empty for the no-credentials **Accept & connect** flow.
- Upload `ilaya-captive-portal.zip` in the **Templates** tab, then select it as the zone's custom template.
- Save and apply

### Step 5: Firewall Rules
- VLAN10 (Guest) → can access internet only
- VLAN20 (Management) → can access internet + all VMs
- Block VLAN10 from accessing VLAN20

---

## 4. Zabbix VM Setup

- Connect to `vmbr1` (LAN)
- Assign static IP: `192.168.20.10`
- Install Zabbix and add these hosts to monitor:

| Host          | IP               |
|---------------|------------------|
| OPNsense      | 192.168.20.1     |
| Access Point  | 192.168.20.x     |
| Admin Server  | 192.168.20.20    |

---

## 5. Admin Portal VM Setup

- Connect to `vmbr1` (LAN)
- Assign static IP: `192.168.20.20`
- Run the Node.js admin server:

```bash
cd admin
node server.js
```

- The dashboard listens at `http://127.0.0.1:8766/` by default. It shows demo data until the OPNsense API settings are provided. See `README.md` for the required environment variables.
- To open it from another device on the management VLAN, use an authenticated HTTPS reverse proxy. The Node.js server is intentionally bound to loopback, so `http://192.168.20.20:8766/` will not work directly.

---

## Traffic Flow

### Guest User (WiFi)
```
User connects to WiFi (VLAN 10)
        ↓
TP-Link switch tags traffic as VLAN 10
        ↓
OPNsense receives on VLAN10 interface
        ↓
Captive Portal intercepts HTTP request
        ↓
User sees portal login page (portal/index.html)
        ↓
User accepts the Wi-Fi guidelines → OPNsense grants access to the device
```

### Monitoring (Zabbix)
```
Zabbix VM (VLAN 20)
        ↓
Monitors OPNsense, AP, Admin Server via SNMP/agent
        ↓
Sends alerts if something goes down
```

---

## Summary

- **OPNsense** — router, firewall, DHCP, captive portal
- **TP-Link Switch** — VLAN segmentation (guest vs management)
- **Proxmox** — hosts all VMs (OPNsense, Zabbix, Admin Portal)
- **Zabbix** — monitors the entire network
- **Access Point** — provides WiFi to guest users
- **Captive Portal** — presents the school Wi-Fi guidelines and asks OPNsense to authorize the device; no username or password is needed when the zone has no authentication server
