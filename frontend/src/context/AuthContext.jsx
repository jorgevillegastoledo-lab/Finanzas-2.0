import React, { createContext, useState, useEffect } from "react";
import api from "../api/api";

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const storedUser = localStorage.getItem("user");
    if (token && storedUser) {
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);
  }, []);

const login = async (email, password) => {
  try {
    const { data } = await api.post("/auth/login-json", { email, password });
    const token = data.access_token;
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify({ email }));
    setUser({ email });
    return true;                // <- importante
  } catch (err) {
    console.error("Error en login", err);
    return false;               // <- importante
  }
};


  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
