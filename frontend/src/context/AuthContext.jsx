import { createContext, useContext, useEffect, useState } from "react";
import { getToken, setToken as saveToken, clearToken } from "../api/token";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [token, setToken] = useState(getToken());

  useEffect(() => { token ? saveToken(token) : clearToken(); }, [token]);
  const logout = () => setToken(null);

  return (
    <AuthContext.Provider value={{ token, setToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
