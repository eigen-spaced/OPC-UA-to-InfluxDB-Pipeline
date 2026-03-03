# OPC UA Water Treatment Simulation Server

A production-quality OPC UA server that simulates a water treatment facility with realistic process dynamics. Built with [node-opcua](https://github.com/node-opcua/node-opcua) for industrial automation learning, SCADA integration testing, and portfolio demonstration.

## What This Simulates

A three-subsystem water treatment plant:

- **Tank Farm** — Two tanks with fill/drain valve control, gravity-based drain dynamics, temperature monitoring, and high-high / low-low level alarms with hysteresis
- **Pump Station** — Two pumps with speed control, current draw modeling (Gaussian noise), runtime-hour accumulation, fault tracking, and automatic dry-run protection
- **Quality Monitoring** — pH (mean-reverting with step disturbances), turbidity (baseline + random rain-event spikes), and chlorine residual sensors

All physics run in-memory at a configurable tick rate (default 500 ms). No external database is required.

## Prerequisites

- **Node.js** >= 18.0.0
- **npm** (included with Node.js)
- macOS, Linux, or Windows

## Installation

```bash
cd opc-ua-influx-pipeline
npm install
```

PKI certificates are generated automatically on first run and stored in `./pki/`.

## Running

**Standard mode:**

```bash
npm start
```

**Development mode** (auto-restart on file changes):

```bash
npm run dev
```

The server prints its endpoint URL, active security policies, and the full node list on startup.

## OPC UA Address Space

### Node Tree

```
Objects/
└── WaterTreatment/
    ├── TankFarm/
    │   ├── Tank1/
    │   │   ├── Level            (Double, RO)  0–100 %
    │   │   ├── FillValve        (Double, RW)  0–100 %
    │   │   ├── DrainValve       (Double, RW)  0–100 %
    │   │   ├── HighHighAlarm    (Boolean, RO)
    │   │   ├── LowLowAlarm     (Boolean, RO)
    │   │   └── Temperature      (Double, RO)  °C
    │   └── Tank2/  (same structure)
    ├── PumpStation/
    │   ├── Pump1/
    │   │   ├── Running          (Boolean, RW) true/false
    │   │   ├── Speed            (Double, RW)  0–100 %
    │   │   ├── Current          (Double, RO)  A
    │   │   ├── RuntimeHours     (Double, RO)  hours
    │   │   ├── Fault            (Boolean, RW) write false to clear
    │   │   └── FaultCode        (Int32, RO)   0=none, 1=dry-run
    │   └── Pump2/  (same structure)
    └── QualityMonitoring/
        ├── pH                   (Double, RO)  pH units
        ├── Turbidity            (Double, RO)  NTU
        └── ChlorineResidual     (Double, RO)  mg/L
```

### Writable Nodes

| Node Path | Type | Valid Range | Notes |
|---|---|---|---|
| `.../Tank1/FillValve` | Double | 0.0 – 100.0 | Valve opening percentage |
| `.../Tank1/DrainValve` | Double | 0.0 – 100.0 | Valve opening percentage |
| `.../Tank2/FillValve` | Double | 0.0 – 100.0 | Valve opening percentage |
| `.../Tank2/DrainValve` | Double | 0.0 – 100.0 | Valve opening percentage |
| `.../Pump1/Running` | Boolean | true / false | Start/stop command |
| `.../Pump1/Speed` | Double | 0.0 – 100.0 | Speed setpoint |
| `.../Pump1/Fault` | Boolean | write `false` | Clears active fault |
| `.../Pump2/Running` | Boolean | true / false | Start/stop command |
| `.../Pump2/Speed` | Double | 0.0 – 100.0 | Speed setpoint |
| `.../Pump2/Fault` | Boolean | write `false` | Clears active fault |

Out-of-range writes are clamped with a warning logged to the server console.

## Security Configuration

The server supports three security modes:

| Policy | Mode | Use Case |
|---|---|---|
| None | None | Development / testing |
| Basic256Sha256 | Sign | Message integrity |
| Basic256Sha256 | SignAndEncrypt | Full encryption |

### Authentication

- **Anonymous** — enabled by default, no credentials needed
- **Username / Password** — user: `operator`, password: `password123`

Credentials are configured in `src/config.js` under `auth`.

### Certificates

Self-signed certificates are auto-generated into `./pki/` on first startup. For secure clients:

1. Start the server once to generate certs
2. Find the server certificate in `./pki/own/certs/`
3. Import it into your client's trusted certificate store
4. The server auto-trusts client certificates (`automaticallyAcceptUnknownCertificate: true`)

## Connecting Clients

### UaExpert (Step by Step)

1. Start the simulation server (`npm start`)
2. Open UaExpert and click **Server → Add**
3. Under **Custom Discovery**, double-click **< Double click to Add Server... >**
4. Enter the endpoint URL: `opc.tcp://localhost:4840/UA/WaterTreatment`
5. Click **OK** — the server appears in the tree
6. Expand the server entry and select a security policy (choose `None` for quick testing)
7. Click **OK** to add, then **Connect**
8. If prompted for authentication, choose Anonymous or enter `operator` / `password123`
9. In the **Address Space** panel, navigate to **Objects → WaterTreatment**
10. Drag nodes into the **Data Access View** to monitor live values
11. To write: right-click a writable node → **Write...** → enter value → **OK**

### Python (opcua-asyncio)

```python
import asyncio
from asyncua import Client

async def main():
    url = "opc.tcp://localhost:4840/UA/WaterTreatment"
    async with Client(url=url) as client:
        # Browse the namespace index (usually 1 for the first custom namespace)
        nsidx = await client.get_namespace_index("urn:WaterTreatmentSim")

        # Read tank level
        level_node = client.get_node(f"ns={nsidx};s=Tank1.Level")
        # Or browse by path:
        root = client.nodes.objects
        tank1_level = await root.get_child(
            [f"{nsidx}:WaterTreatment", f"{nsidx}:TankFarm",
             f"{nsidx}:Tank1", f"{nsidx}:Level"]
        )
        value = await tank1_level.read_value()
        print(f"Tank 1 Level: {value:.1f}%")

        # Write fill valve
        fill_valve = await root.get_child(
            [f"{nsidx}:WaterTreatment", f"{nsidx}:TankFarm",
             f"{nsidx}:Tank1", f"{nsidx}:FillValve"]
        )
        await fill_valve.write_value(75.0)
        print("Set Tank1 FillValve to 75%")

        # Subscribe to changes
        handler = asyncio.Queue()
        sub = await client.create_subscription(500, handler)
        await sub.subscribe_data_change(tank1_level)

        for _ in range(10):
            msg = await asyncio.wait_for(handler.get(), timeout=5)
            print(f"  Level update: {msg}")

asyncio.run(main())
```

### Ignition SCADA

1. Open Ignition Designer
2. Go to **Config → OPC Connections → Servers**
3. Click **Create new OPC Connection** → **OPC UA Connection**
4. Set **Endpoint URL**: `opc.tcp://<server-ip>:4840/UA/WaterTreatment`
5. **Security Policy**: None (for testing) or Basic256Sha256
6. **Authentication**: Anonymous or Username (`operator` / `password123`)
7. Click **Save** — verify status shows **Connected**
8. Browse tags under the connection in the OPC Browser panel
9. Drag tags onto screens or bind them to Tag Historian for trending

### Node-RED

1. Install the `node-red-contrib-opcua` palette
2. Drag an **OpcUa-Client** node onto the flow
3. Configure the endpoint: `opc.tcp://localhost:4840/UA/WaterTreatment`
4. Set action to **SUBSCRIBE** or **READ**
5. Use browse path or NodeId to target specific variables
6. Wire to debug or dashboard nodes

## Configuration

All tunable parameters live in `src/config.js`:

- **Server**: port, resource path, manufacturer info
- **Authentication**: username / password
- **Simulation**: tick rate, alarm thresholds (with hysteresis)
- **Tank Farm**: fill/drain rates, temperature dynamics per tank
- **Pump Station**: nominal current, noise levels, dry-run protection threshold
- **Quality**: pH drift/disturbance rates, turbidity spike parameters, chlorine drift

## Project Structure

```
opc-ua-influx-pipeline/
├── src/
│   ├── server.js          # Entry point — server init, lifecycle, shutdown
│   ├── addressSpace.js    # OPC UA node definitions and write handlers
│   ├── simulation.js      # Physics engine — tanks, pumps, quality sensors
│   └── config.js          # All tunable parameters
├── pki/                   # Auto-generated certificates (git-ignored)
├── package.json
├── .gitignore
└── README.md
```

## Architecture Note

This project was scaffolded with AI assistance (Claude, Anthropic) and reviewed/tested by the author. The simulation physics, address space structure, and security configuration were designed to reflect realistic industrial automation patterns for learning purposes.

## License

MIT
