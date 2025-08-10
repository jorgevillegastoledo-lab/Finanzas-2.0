import React, { useContext } from "react";
import { Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";

export default function TopNav({ active }) {
  const { user, logout } = useContext(AuthContext);

  const Item = ({ to, id, children }) => (
    <Link
      to={to}
      style={{
        ...styles.link,
        ...(active === id ? styles.linkActive : {})
      }}
    >
      {children}
    </Link>
  );

  return (
    <header style={styles.header}>
      <div style={{ fontWeight: 700 }}>📊 Finanzas 2.0</div>

      <nav style={styles.nav}>
        <Item to="/" id="home">Dashboard</Item>
        <Item to="/gastos" id="gastos">Gastos</Item>
        <Item to="/prestamos" id="prestamos">Préstamos</Item>
        <Item to="/tarjetas" id="tarjetas">Facturación tarjetas</Item>
        <Item to="/sueldo" id="sueldo">Ingresar sueldo</Item>
      </nav>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{ opacity: .8 }}>{user?.email}</span>
        <button onClick={logout} style={styles.btn}>Salir</button>
      </div>
    </header>
  );
}

const styles = {
  header: {
    display: "grid",
    gridTemplateColumns: "160px 1fr auto",
    gap: 16,
    alignItems: "center",
    padding: "12px 18px",
    borderBottom: "1px solid #1f2a44",
    background: "#0f1a2a",
    color: "#e6f0ff"
  },
  nav: { display: "flex", gap: 10, flexWrap: "wrap" },
  link: {
    padding: "6px 10px",
    borderRadius: 8,
    background: "transparent",
    color: "#e6f0ff",
    textDecoration: "none",
    border: "1px solid transparent"
  },
  linkActive: { background: "#1b2a46", border: "1px solid #2a3d63" },
  btn: {
    padding: "8px 12px",
    border: 0,
    borderRadius: 8,
    background: "#71d07e",
    color: "#032312",
    fontWeight: 700,
    cursor: "pointer"
  }
};
