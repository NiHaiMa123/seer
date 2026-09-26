import { startServer } from "../apps/server/src/index.ts";
const s = await startServer(0);
const b = await fetch(`${s.url}/api/battle`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({seedHex:"a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5"})}).then(r=>r.json());
const h = s.battles.get(b.battleId);
console.log("rng:", JSON.stringify(h.host.state.battle.rng));
console.log("len:", h.host.state.battle.rng.seedHex?.length);
await s.close();
