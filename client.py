import asyncio
from asyncua import Client

URL = "opc.tcp://localhost:4840/UA/WaterTreatment"
NAMESPACE = "urn:WaterTreatmentSim"


NODES = {
    "Tank1/Level": {"path": ["WaterTreatment", "TankFarm", "Tank1", "Level"],     "unit": "%", "fmt": ".1f"},
    "Tank2/Level": {"path": ["WaterTreatment", "TankFarm", "Tank2", "Level"],     "unit": "%", "fmt": ".1f"},
    "pH":          {"path": ["WaterTreatment", "QualityMonitoring", "pH"],        "unit": "",  "fmt": ".2f"},
    "Turbidity":   {"path": ["WaterTreatment", "QualityMonitoring", "Turbidity"], "unit": "",  "fmt": ".2f"},
}


class SubscriptionHandler:
    def __init__(self, node_labels):
        self.node_labels = node_labels

    def datachange_notification(self, node, val, data):
        label, fmt, unit = self.node_labels.get(node.nodeid, ("Unknown", "", ""))
        print(f"  {label:<16} {val:{fmt}} {unit}")


async def main():
    async with Client(url=URL) as client:
        nsidx = await client.get_namespace_index(NAMESPACE)
        root = client.nodes.objects

        # Resolve nodes and build label map
        resolved = []
        node_labels = {}
        for label, info in NODES.items():
            browse_path = [f"{nsidx}:{segment}" for segment in info["path"]]
            node = await root.get_child(browse_path)
            resolved.append(node)
            node_labels[node.nodeid] = (label, info["fmt"], info["unit"])

            val = await node.read_value()
            print(f"{label:<16} {val:{info['fmt']}} {info['unit']}")

        # Subscribe to all nodes
        handler = SubscriptionHandler(node_labels)
        sub = await client.create_subscription(500, handler)
        await sub.subscribe_data_change(resolved)
        print(f"\nSubscribed to {len(resolved)} nodes. Ctrl+C to exit.\n")

        try:
            while True:
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            pass


if __name__ == "__main__":
    asyncio.run(main())
