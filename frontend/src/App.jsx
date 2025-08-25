// frontend/src/App.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import { NotificationsProvider } from "./ui/notifications";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Gastos from "./pages/Gastos";
import Prestamos from "./pages/Prestamos";
import Tarjetas from "./pages/Tarjetas";
import Sueldo from "./pages/Sueldo";
import FacturacionTarjetas from "./pages/FacturacionTarjetas";

// Menu maestros
import AdminConceptos from "./pages/AdminConceptos";
import AdminBancos from "./pages/AdminBancos";
import FormasPago from "./pages/FormasPago"; 

export default function App() {
  return (
    <AuthProvider>
      {/* (si usas notifications, envuelve aquí; lo dejo como lo tenías) */}
      <Routes>
        {/* Público */}
        <Route path="/login" element={<Login />} />

        {/* Privados */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/gastos"
          element={
            <ProtectedRoute>
              <Gastos />
            </ProtectedRoute>
          }
        />
        <Route
          path="/prestamos"
          element={
            <ProtectedRoute>
              <Prestamos />
            </ProtectedRoute>
          }
        />
        <Route
          path="/facturacion"
          element={
            <ProtectedRoute>
              <FacturacionTarjetas />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sueldo"
          element={
            <ProtectedRoute>
              <Sueldo />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tarjetas"
          element={
            <ProtectedRoute>
              <Tarjetas />
            </ProtectedRoute>
          }
        />

        {/* NUEVO: Maestros */}
        <Route
          path="/admin/conceptos"
          element={
            <ProtectedRoute>
              <AdminConceptos />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/bancos"
          element={
            <ProtectedRoute>
              <AdminBancos />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/formaspago"
          element={
            <ProtectedRoute>
              <FormasPago />
            </ProtectedRoute>
          }
        />


        {/* Cualquier otra ruta → home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
