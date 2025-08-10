// frontend/src/context/AuthContext.jsx
import React, { createContext, useEffect, useState } from "react";
import api from "../api/api";

// Context que podrás usar con useContext(AuthContext)
export const AuthContext = createContext();

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);     // { email }
  const [loading, setLoading] = useState(true);

  // Al montar la app, restaurar sesión si hay token+user en localStorage
  useEffect(() => {
    const token = localStorage.getItem("token");
    const storedUser = localStorage.getItem("user");
    if (token && storedUser) {
      try {
        const u = JSON.parse(storedUser);
        setUser(u); // { email }
      } catch {
        // si falla el parse, limpiamos
        localStorage.removeItem("user");
      }
    }
    setLoading(false);
  }, []);

  /**
   * Iniciar sesión.
   * Devuelve true si OK, false si fallo (credenciales inválidas, etc.).
   */
  const login = async (email, password) => {
    try {
      // Opción JSON (coincide con tu backend /auth/login-json)
      const { data } = await api.post("/auth/login-json", { email, password });

      // Guardar token y usuario
      localStorage.setItem("token", data.access_token);   // ⚠ la clave "token" es la que usa tu api.js
      localStorage.setItem("user", JSON.stringify({ email }));

      // (opcional) setear el header de axios para esta sesión inmediata
      api.defaults.headers.common.Authorization = `Bearer ${data.access_token}`;

      setUser({ email });
      return true;
    } catch (err) {
      console.error("Error en login:", err?.response?.data || err.message);
      return false;
    }
  };

  /**
   * Cerrar sesión: limpia storage y estado
   */
  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  };

  const value = {
    user,
    loading,
    isAuthenticated: !!user,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
