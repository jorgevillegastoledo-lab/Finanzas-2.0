// frontend/src/pages/Sueldo.jsx
import React, { useState } from "react";
import AppShell, { ui } from "../components/AppShell";

export default function Sueldo() {
  const [monto, setMonto] = useState("");
  const [msg, setMsg] = useState("");

  const guardar = (e) => {
    e.preventDefault();
    if (!monto) return setMsg("Ingresa un monto");
    // TODO: POST al backend /sueldo (cuando lo tengas)
    setMsg("Guardado (demo). Luego lo conectamos a la API.");
  };

  return (
    <AppShell title="Ingresar sueldo">
      <section style={ui.card}>
        <form onSubmit={guardar} style={{ display:"flex", gap:12, alignItems:"center" }}>
          <input
            type="number"
            placeholder="Monto"
            value={monto}
            onChange={(e)=>setMonto(e.target.value)}
            style={{ padding:"10px 12px", borderRadius:8, border:"1px solid #23304a", background:"#0e1626", color:"#e6f0ff" }}
          />
          <button style={ui.btn} type="submit">Guardar</button>
        </form>
        {msg && <div style={{ marginTop:10, opacity:.9 }}>{msg}</div>}
      </section>
    </AppShell>
  );
}
