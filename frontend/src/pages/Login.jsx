import React, { useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";

export default function Login() {
  const { login } = useContext(AuthContext);
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@finanzas.com");
  const [password, setPassword] = useState("123456");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const ok = await login(email, password);
    setBusy(false);
    if (ok) {
      nav("/");                // <- redirige al Dashboard
    } else {
      setError("Credenciales inválidas o error de conexión.");
    }
  };

  return (
    <div style={styles.container}>
      <h2>Iniciar Sesión</h2>
      <form onSubmit={handleSubmit} style={styles.form}>
        <input
          type="email"
          placeholder="Correo electrónico"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={styles.input}
          required
        />
        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
          required
        />
        {error && <p style={styles.error}>{error}</p>}
        <button type="submit" style={styles.button} disabled={busy}>
          {busy ? "Ingresando..." : "Ingresar"}
        </button>
      </form>
    </div>
  );
}

const styles = {
  container: { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100vh", background:"#f7f7f7" },
  form: { display:"flex", flexDirection:"column", gap:10, background:"#fff", padding:20, borderRadius:8, boxShadow:"0 2px 10px rgba(0,0,0,.1)", width:300 },
  input: { padding:10, fontSize:14, border:"1px solid #ccc", borderRadius:5 },
  button: { padding:10, fontSize:16, background:"#4CAF50", color:"#fff", border:"none", borderRadius:5, cursor:"pointer" },
  error: { color:"red", fontSize:14 }
};
