// frontend/src/context/AuthContext.jsx
import React, { createContext, useEffect, useState } from "react";
import api from "../api/api";

// Contexto que podrás usar con useContext(AuthContext)
export const AuthContext = createContext();

// Exportación **con nombre** (named) que espera App.jsx
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restaura sesión desde localStorage al montar
  useEffect(() => {
    const token = localStorage.getItem("token");
    const stored = localStorage.getItem("user");
    if (token && stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem("user");
      }
    }
    setLoading(false);
  }, []);

  // Login: pide token al backend y guarda sesión
  const login = async (email, password) => {
    try {
      const { data } = await api.post("/auth/login-json", { email, password });
      const token = data.access_token;

      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify({ email }));

      setUser({ email });
      return true;
    } catch (err) {
      console.error("Error en login:", err);
      return false;
    }
  };

  // Logout: limpia sesión
  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {/* Evita parpadear mientras restaura sesión */}
      {!loading && children}
    </AuthContext.Provider>
  );
}

// (Opcional) también exporto por defecto, por si lo necesitas
export default AuthProvider;
