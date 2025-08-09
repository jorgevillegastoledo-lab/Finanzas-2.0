import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import Gastos from "./pages/Gastos";
import Prestamos from "./pages/Prestamos";
import Tarjetas from "./pages/Tarjetas";
import Login from "./pages/Login";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Layout><ProtectedRoute><Dashboard /></ProtectedRoute></Layout>} />
        <Route path="/gastos" element={<Layout><ProtectedRoute><Gastos /></ProtectedRoute></Layout>} />
        <Route path="/prestamos" element={<Layout><ProtectedRoute><Prestamos /></ProtectedRoute></Layout>} />
        <Route path="/tarjetas" element={<Layout><ProtectedRoute><Tarjetas /></ProtectedRoute></Layout>} />
      </Routes>
    </BrowserRouter>
  );
}
