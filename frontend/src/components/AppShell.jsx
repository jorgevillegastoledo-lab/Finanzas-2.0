// frontend/src/components/AppShell.jsx
import React, { useContext } from "react";
import { NavLink } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";

export default function AppShell({ title = "Panel", actions, children }) {
  const { user, logout } = useContext(AuthContext);

  // Para evitar reuso de objetos estilo, usamos funciones que devuelven el estilo final
  const navStyle = ({ isActive }) => ({
    ...ui.navLink,
    ...(isActive ? ui.navLinkActive : {}),
  });

  return (
    <div style={ui.wrapper}>
      {/* Header fijo con marca, tabs y usuario */}
      <header style={ui.header}>
        <div style={ui.brandRow}>
          <div style={ui.brand}>
            <span>📊</span>
            <span>Finanzas 2.0</span>
            <span style={ui.brandMuted}>— {title}</span>
          </div>

          {/* Tabs (mismo menú para todas las páginas) */}
          <nav style={ui.nav}>
            <NavLink to="/" end style={navStyle}>Dashboard</NavLink>
            <NavLink to="/gastos" style={navStyle}>Gastos</NavLink>
            <NavLink to="/prestamos" style={navStyle}>Préstamos</NavLink>
            <NavLink to="/tarjetas" style={navStyle}>Facturación tarjetas</NavLink>
            <NavLink to="/sueldo" style={navStyle}>Ingresar sueldo</NavLink>
          </nav>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ opacity: .8 }}>{user?.email}</span>
          <button style={ui.btn} onClick={logout}>Salir</button>
        </div>
      </header>

      {/* Contenido */}
      <main style={ui.main}>
        <div style={ui.titleBar}>
          <h1 style={ui.h1}>{title}</h1>
          <div>{actions}</div>
        </div>
        {children}
      </main>
    </div>
  );
}

export const ui = {
  wrapper: { minHeight: "100vh", background: "#0b1220", color: "#e6f0ff" },

  header: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "12px 18px",
    borderBottom: "1px solid #1f2a44",
    background: "#0f1a2a",
  },

  brandRow: { display: "flex", alignItems: "center", gap: 18 },
  brand: { display: "flex", alignItems: "center", gap: 10, fontWeight: 800 },
  brandMuted: { opacity: .6, fontWeight: 400 },

  nav: { display: "flex", gap: 8 },
  navLink: {
    padding: "8px 10px",
    borderRadius: 10,
    textDecoration: "none",
    color: "#e6f0ff",
    background: "transparent",
    fontWeight: 600,
  },
  navLinkActive: {
    background: "#71d07e",
    color: "#032312",
  },

  main: { padding: 24, display: "grid", gap: 16 },
  titleBar: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  h1: { margin: 0, fontSize: 20 },

  card: { background:"#121a2b", padding:20, borderRadius:12, boxShadow:"0 10px 30px rgba(0,0,0,.35)" },
  btn: { padding:"8px 12px", border:0, borderRadius:8, background:"#71d07e", color:"#032312", fontWeight:700, cursor:"pointer" },
  badge: { background:"#1e2a44", padding:"4px 8px", borderRadius: 999, fontSize:12, opacity:.9 }
};

